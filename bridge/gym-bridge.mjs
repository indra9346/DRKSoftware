#!/usr/bin/env node
// Gym bridge: runs on the front-desk PC at the gym and relays the eSSL fingerprint
// machine's ADMS traffic (plain HTTP on the gym Wi-Fi/LAN) to the gym software (HTTPS).
// Needed when the machine's firmware cannot talk HTTPS. No packages to install: Node 18+ only.
//
//   set GYM_SOFTWARE_URL=https://drk-fitness.onrender.com
//   node gym-bridge.mjs                (listens on port 8081)
//
// On the machine: Comm. -> Cloud Server Setting -> Server Address = this PC's LAN IP
// (e.g. 192.168.1.20), Server Port = 8081, HTTPS off.

import http from "node:http";
import os from "node:os";

const TARGET = (process.env.GYM_SOFTWARE_URL ?? process.argv[2] ?? "").replace(
  /\/+$/,
  ""
);
const PORT = Number(process.env.BRIDGE_PORT ?? process.argv[3] ?? 8081);

if (!/^https?:\/\//.test(TARGET)) {
  console.error(
    "Usage: GYM_SOFTWARE_URL=https://your-gym-software-domain node gym-bridge.mjs [port]"
  );
  process.exit(1);
}

const stamp = () =>
  new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
let lastPoll = 0;

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (!url.startsWith("/iclock/")) {
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end(`Gym bridge is running and relays /iclock/ to ${TARGET}\n`);
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(TARGET + url, {
      method: req.method,
      body: req.method === "POST" ? body : undefined,
      headers: {
        "content-type": req.headers["content-type"] ?? "text/plain",
        "user-agent": req.headers["user-agent"] ?? "eSSL",
        "x-gym-bridge": os.hostname(),
      },
      signal: AbortSignal.timeout(25_000),
    });
    const out = Buffer.from(await upstream.arrayBuffer());
    // The machine sets its clock from Date (plus the TimeZone option), so pass the server's through.
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "text/plain",
      date: upstream.headers.get("date") ?? new Date().toUTCString(),
      "content-length": out.length,
    });
    res.end(out);
    const quiet =
      url.startsWith("/iclock/getrequest") && out.toString().trim() === "OK";
    if (!quiet || Date.now() - lastPoll > 60_000) {
      console.log(
        `${stamp()} ${req.method} ${url.split("?")[0]} -> ${upstream.status} ${out.toString().slice(0, 80).replace(/\s+/g, " ")}`
      );
      if (quiet) lastPoll = Date.now();
    }
  } catch (e) {
    // The machine keeps its punches and retries after ErrorDelay, so nothing is lost while offline.
    console.log(
      `${stamp()} ${req.method} ${url.split("?")[0]} -> internet/server unreachable (${e instanceof Error ? e.message : e}); machine will retry`
    );
    res.writeHead(503, { "content-type": "text/plain" }).end("ERROR");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === "IPv4" && !i.internal)
    .map(i => i.address);
  console.log(
    `Gym bridge listening on port ${PORT}, relaying to ${TARGET}`
  );
  console.log(
    `Set the fingerprint machine's Server Address to one of: ${ips.join(", ") || "(no network found)"} and Server Port ${PORT}`
  );
});
