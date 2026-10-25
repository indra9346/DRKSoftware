#!/usr/bin/env node
// Pretends to be an eSSL / ZKTeco fingerprint machine talking ADMS (PUSH protocol) to the
// Fit Crush software. Use it to rehearse the setup before touching the real machine.
//
//   node scripts/essl-simulator.mjs --server http://127.0.0.1:3500 --sn FITCRUSH-SIM \
//        --enroll 1001,1002 --punch 1001 --polls 5
//   node scripts/essl-simulator.mjs --server http://127.0.0.1:3500 --interactive
//       (then type a member ID + Enter to "place a finger"; q to quit)
//
// It answers every command like a real machine (Return=0), uploads fingerprint templates when
// asked or after a remote enrolment, and forgets fingerprints the software deletes, so a blocked
// member's punch is refused just like on the real machine.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--"))
      acc.push([
        a.slice(2),
        all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1",
      ]);
    return acc;
  }, [])
);
const SERVER = (args.server ?? "http://127.0.0.1:3500").replace(/\/$/, "");
const SN = args.sn ?? "FITCRUSH-SIM";
const DELAY = Number(args.delay ?? 3) * 1000;

/** pin -> { name, card, password, fingers: Map<fid, template> } : what this "machine" holds. */
const users = new Map();
// The machine's memory survives between runs (like the real one), in a small JSON file.
const STATE = args.state ?? `.data/simulator-${SN}.json`;

function loadState() {
  if (!existsSync(STATE)) return;
  for (const [pin, u] of Object.entries(
    JSON.parse(readFileSync(STATE, "utf8"))
  )) {
    users.set(pin, {
      ...u,
      fingers: new Map(
        Object.entries(u.fingers).map(([f, t]) => [Number(f), t])
      ),
    });
  }
}

function saveState() {
  mkdirSync(dirname(STATE), { recursive: true });
  const plain = Object.fromEntries(
    [...users].map(([pin, u]) => [
      pin,
      { ...u, fingers: Object.fromEntries(u.fingers) },
    ])
  );
  writeFileSync(STATE, JSON.stringify(plain, null, 2));
}

const istNow = () =>
  new Date(Date.now() + 330 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
const fakeTemplate = (pin, fid) =>
  Buffer.from(`FITCRUSH-SIM-TEMPLATE-${pin}-${fid}`).toString("base64");

async function http(method, path, query, body) {
  const qs = new URLSearchParams({ SN: SN, ...query }).toString();
  const res = await fetch(`${SERVER}/iclock/${path}?${qs}`, {
    method,
    body,
    headers: body ? { "content-type": "text/plain" } : {},
  });
  return {
    status: res.status,
    text: await res.text(),
    date: res.headers.get("date"),
  };
}

function log(...m) {
  console.log(`[${istNow().slice(11)}]`, ...m);
}

async function handshake() {
  const r = await http("GET", "cdata", {
    options: "all",
    pushver: "2.4.1",
    language: "69",
  });
  log(`handshake -> HTTP ${r.status}; server Date: ${r.date}`);
  for (const line of r.text
    .split("\n")
    .filter(l => /Stamp=|Delay=|TimeZone=|TransFlag=/.test(l)))
    log("   ", line);
}

async function uploadUsers(pins) {
  const lines = [];
  for (const pin of pins) {
    const u = users.get(pin) ?? {
      name: `Member ${pin}`,
      card: "",
      password: "",
      fingers: new Map([[6, fakeTemplate(pin, 6)]]),
    };
    users.set(pin, u);
    lines.push(
      `USER PIN=${pin}\tName=${u.name}\tPri=0\tPasswd=${u.password}\tCard=${u.card}\tGrp=1\tTZ=0000000000000000\tVerify=-1`
    );
    for (const [fid, tmp] of u.fingers)
      lines.push(
        `FP PIN=${pin}\tFID=${fid}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`
      );
  }
  const r = await http(
    "POST",
    "cdata",
    { table: "OPERLOG", Stamp: String(Date.now()) },
    lines.join("\n")
  );
  log(
    `uploaded ${pins.length} user(s) with fingerprints -> HTTP ${r.status} ${r.text}`
  );
}

async function punch(pin) {
  const u = users.get(pin);
  if (!u || u.fingers.size === 0) {
    log(
      `finger ${pin}: NOT RECOGNISED by the machine (no fingerprint on it) - door stays shut, nothing uploaded`
    );
    return;
  }
  const r = await http(
    "POST",
    "cdata",
    { table: "ATTLOG", Stamp: String(Date.now()) },
    `${pin}\t${istNow()}\t0\t1\t0\t0\t0`
  );
  log(
    `finger ${pin}: verified, door opened, punch uploaded -> HTTP ${r.status} ${r.text}`
  );
}

/** "DATA UPDATE USERINFO PIN=1\tName=A B" -> { kind: "DATA UPDATE USERINFO", kv: { PIN, Name } } */
function parseCmd(cmd) {
  const kind = cmd
    .split(" ")
    .slice(0, cmd.startsWith("DATA ") ? 3 : 1)
    .join(" ");
  const kv = Object.fromEntries(
    cmd
      .slice(kind.length)
      .trim()
      .split("\t")
      .filter(p => p.includes("="))
      .map(p => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)])
  );
  return { kind, kv };
}

async function apply(id, cmd) {
  const { kind, kv } = parseCmd(cmd);
  const pin = kv.PIN;
  let ret = 0;
  let after = null;
  if (kind.startsWith("DATA UPDATE USERINFO")) {
    const u = users.get(pin) ?? { fingers: new Map() };
    users.set(pin, {
      ...u,
      name: kv.Name,
      card: kv.Card ?? "",
      password: kv.Passwd ?? "",
    });
  } else if (kind.startsWith("DATA DELETE USERINFO")) {
    users.delete(pin);
  } else if (kind.startsWith("DATA DELETE FINGERTMP")) {
    users.get(pin)?.fingers.clear();
  } else if (kind.startsWith("DATA UPDATE FINGERTMP")) {
    const u = users.get(pin) ?? { name: `Member ${pin}`, fingers: new Map() };
    u.fingers.set(Number(kv.FID), kv.TMP);
    users.set(pin, u);
  } else if (kind.startsWith("DATA QUERY FINGERTMP")) {
    after = () => (users.get(pin)?.fingers.size ? uploadUsers([pin]) : null);
  } else if (cmd.startsWith("ENROLL_FP")) {
    const u = users.get(pin);
    if (!u) ret = -10;
    else {
      u.fingers.set(Number(kv.FID), fakeTemplate(pin, kv.FID));
      after = () => uploadUsers([pin]);
    }
  } else if (cmd === "CHECK") {
    after = async () => {
      await handshake();
      await uploadUsers([...users.keys()]);
    };
  }
  const short = cmd.replace(/TMP=\S+/, "TMP=…").replace(/\t/g, " ");
  log(`<- C:${id}: ${short}${ret ? `  (Return=${ret})` : ""}`);
  return { line: `ID=${id}&Return=${ret}&CMD=${cmd.split(" ")[0]}`, after };
}

async function poll() {
  const r = await http("GET", "getrequest", {
    INFO: `Ver 8.0.4-SIM,${users.size},${[...users.values()].reduce((s, u) => s + u.fingers.size, 0)},0,127.0.0.1,10,7,0,0,000000`,
  });
  if (r.status !== 200 || r.text.trim() === "OK") return 0;
  const results = [];
  const afters = [];
  for (const line of r.text.split("\n")) {
    const m = /^C:(\d+):(.*)$/s.exec(line);
    if (!m) continue;
    const { line: result, after } = await apply(m[1], m[2]);
    results.push(result);
    if (after) afters.push(after);
  }
  if (results.length) await http("POST", "devicecmd", {}, results.join("\n"));
  for (const a of afters) await a();
  saveState();
  return results.length;
}

async function main() {
  loadState();
  log(`eSSL simulator ${SN} -> ${SERVER} (memory: ${STATE})`);
  await handshake();
  if (args.enroll) {
    // Enrolling on the machine itself: these users get a finger (only if the machine does not hold
    // them yet). "1001=Aarav Sharma" also sets the name shown on the machine.
    const pins = [];
    for (const entry of String(args.enroll).split(",")) {
      const [pin, name] = entry.split("=").map(s => s.trim());
      if (!pin) continue;
      if (name && !users.has(pin))
        users.set(pin, {
          name,
          card: "",
          password: "",
          fingers: new Map([[6, fakeTemplate(pin, 6)]]),
        });
      pins.push(pin);
    }
    await uploadUsers(pins);
    saveState();
  }
  if (args.punch)
    for (const pin of String(args.punch).split(",")) await punch(pin.trim());
  if (args.interactive) {
    log(
      "Type a member ID and press Enter to place that finger. 'e 1001' enrols user 1001 on this machine. q to quit."
    );
    const rl = createInterface({ input: process.stdin });
    rl.on("line", async l => {
      const t = l.trim();
      if (t === "q") process.exit(0);
      if (t.startsWith("e ")) await uploadUsers([t.slice(2).trim()]);
      else if (/^\d+$/.test(t)) await punch(t);
    });
    for (;;) {
      await poll().catch(e => log("poll failed:", e.message));
      await new Promise(r => setTimeout(r, DELAY));
    }
  }
  const polls = Number(args.polls ?? 3);
  for (let i = 0; i < polls; i++) {
    await poll();
    if (i < polls - 1) await new Promise(r => setTimeout(r, DELAY));
  }
  log(
    "done. Machine now holds:",
    [...users.entries()]
      .map(([p, u]) => `${p}(${u.fingers.size} finger)`)
      .join(" ") || "nobody"
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
