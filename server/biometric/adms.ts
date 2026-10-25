// ZKTeco / eSSL "ADMS" PUSH protocol (the machine's Cloud Server / ADMS setting): pure parsing and
// formatting, no I/O. The machine is the HTTP client:
//   GET  /iclock/cdata?SN=..&options=all        handshake -> server returns its options
//   POST /iclock/cdata?SN=..&table=ATTLOG       punches, one per line
//   POST /iclock/cdata?SN=..&table=OPERLOG      users (USER ..), fingerprints (FP ..), admin ops
//   GET  /iclock/getrequest?SN=..               polls for commands ("C:<id>:<command>" lines)
//   POST /iclock/devicecmd?SN=..                results ("ID=<id>&Return=<code>&CMD=<cmd>")

export interface AttLog {
  pin: string;
  /** Machine wall-clock time, "YYYY-MM-DD HH:MM:SS" (India time). */
  time: string;
  /** Punch-state key the person pressed (0 check-in, 1 check-out, ...); not reliable for in/out. */
  status: number;
  /** How the person was identified; see VERIFY_LABEL. */
  verify: number;
  workcode: string;
}

export interface DeviceUser {
  pin: string;
  name: string;
  privilege: number;
  password: string;
  card: string;
  group: string;
  timezone: string;
  verify: string;
}

export interface FingerTemplate {
  pin: string;
  fid: number;
  size: number;
  valid: number;
  template: string;
}

export type OperRecord =
  | { type: "user"; user: DeviceUser }
  | { type: "fp"; fp: FingerTemplate }
  | {
      type: "oplog";
      code: number;
      admin: string;
      time: string;
      objects: string[];
    }
  | { type: "other"; raw: string };

/** Verify codes differ between firmware generations (old: 0 password, 2 card; new: 3 password, 4 card). */
export const VERIFY_LABEL: Record<number, string> = {
  0: "Password",
  1: "Fingerprint",
  2: "Card",
  3: "Password",
  4: "Card",
  15: "Face",
  25: "Palm",
};

function lines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map(l => l.replace(/\0/g, ""))
    .filter(l => l.trim() !== "");
}

/** "KEY=value\tKEY2=value2" -> map. Values may contain "=". */
export function parseKv(
  s: string,
  sep: RegExp | string = "\t"
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(sep)) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1);
  }
  return out;
}

export function parseAttLog(body: string): AttLog[] {
  const out: AttLog[] = [];
  for (const line of lines(body)) {
    const f = line.split("\t");
    const pin = f[0]?.trim();
    const time = f[1]?.trim();
    if (!pin || !time || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time))
      continue;
    out.push({
      pin,
      time,
      status: Number(f[2] ?? 0) || 0,
      verify: Number(f[3] ?? 0) || 0,
      workcode: (f[4] ?? "").trim(),
    });
  }
  return out;
}

export function parseOperLog(body: string): OperRecord[] {
  const out: OperRecord[] = [];
  for (const line of lines(body)) {
    const space = line.indexOf(" ");
    const head = space > 0 ? line.slice(0, space) : line;
    const rest = space > 0 ? line.slice(space + 1) : "";
    if (head === "USER") {
      const kv = parseKv(rest);
      if (!kv["PIN"]) continue;
      out.push({
        type: "user",
        user: {
          pin: kv["PIN"].trim(),
          name: (kv["Name"] ?? "").trim(),
          privilege: Number(kv["Pri"] ?? 0) || 0,
          password: kv["Passwd"] ?? "",
          card: (kv["Card"] ?? "").trim(),
          group: (kv["Grp"] ?? "").trim(),
          timezone: (kv["TZ"] ?? "").trim(),
          verify: (kv["Verify"] ?? "").trim(),
        },
      });
    } else if (head === "FP") {
      const kv = parseKv(rest);
      if (!kv["PIN"] || kv["TMP"] === undefined) continue;
      out.push({
        type: "fp",
        fp: {
          pin: kv["PIN"].trim(),
          fid: Number(kv["FID"] ?? 0) || 0,
          size: Number(kv["Size"] ?? 0) || 0,
          valid: Number(kv["Valid"] ?? 1) || 0,
          template: kv["TMP"].trim(),
        },
      });
    } else if (head === "OPLOG") {
      const f = rest.split("\t");
      out.push({
        type: "oplog",
        code: Number(f[0] ?? 0) || 0,
        admin: f[1] ?? "",
        time: f[2] ?? "",
        objects: f.slice(3),
      });
    } else {
      out.push({ type: "other", raw: line.slice(0, 200) });
    }
  }
  return out;
}

export interface CommandResult {
  id: number;
  returnCode: number;
  cmd: string;
}

/** devicecmd body: one "ID=12&Return=0&CMD=DATA" per line. */
export function parseCommandResults(body: string): CommandResult[] {
  const out: CommandResult[] = [];
  for (const line of lines(body)) {
    const kv = parseKv(line, "&");
    const id = Number(kv["ID"]);
    if (!Number.isFinite(id) || kv["ID"] === undefined) continue;
    out.push({
      id,
      returnCode: Number(kv["Return"] ?? -1),
      cmd: kv["CMD"] ?? "",
    });
  }
  return out;
}

/** INFO= on getrequest: "firmware,users,fingerprints,punches,ip,fp-algorithm,face-algorithm,faces needed,faces,functions" */
export function parseInfoParam(
  info: string | null
): Record<string, string> | null {
  if (!info) return null;
  const f = info.split(",");
  const keys = [
    "firmware",
    "users",
    "fingerprints",
    "punches",
    "ip",
    "fpVersion",
    "faceVersion",
    "faceNeeded",
    "faces",
    "functions",
  ];
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    if (f[i] !== undefined && f[i] !== "") out[k] = f[i]!.trim();
  });
  return out;
}

export interface HandshakeOptions {
  sn: string;
  attStamp: string | null;
  opStamp: string | null;
  delaySeconds: number;
  /** India is "330": values beyond +/-60 are minutes (PUSH protocol 2.4.1, section 5). */
  timeZone: string;
}

/**
 * Handshake reply (Attendance PUSH protocol 2.4.1). Older firmware without "pushver" reads the
 * Stamp/OpStamp/PhotoStamp names, so both sets are sent. A stamp of "None" asks the machine to
 * upload everything it holds (first connection: all users, fingerprints and punches).
 */
export function handshakeResponse(o: HandshakeOptions): string {
  const att = o.attStamp ?? "None";
  const op = o.opStamp ?? "None";
  return [
    `GET OPTION FROM: ${o.sn}`,
    `ATTLOGStamp=${att}`,
    `OPERLOGStamp=${op}`,
    `ATTPHOTOStamp=None`,
    `Stamp=${att}`,
    `OpStamp=${op}`,
    `PhotoStamp=None`,
    `ErrorDelay=30`,
    `Delay=${o.delaySeconds}`,
    `TransTimes=00:00;14:05`,
    `TransInterval=1`,
    `TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP`,
    `TimeZone=${o.timeZone}`,
    `Realtime=1`,
    `Encrypt=None`,
    `ServerVer=2.4.1`,
    `PushProtVer=2.4.1`,
  ].join("\n");
}

/** Names and messages go into tab-separated commands: strip anything that would break the line. */
export function safeField(s: string, max = 24): string {
  return s
    .replace(/[\t\r\n=]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface UserCommandInput {
  pin: string;
  name: string;
  privilege?: number;
  card?: string;
  password?: string;
  group?: string;
  verify?: string;
}

/**
 * Full user record. Fields sent empty are cleared on the machine (privilege, password, card), so
 * callers pass what the machine last reported for this user.
 */
export function cmdUpdateUser(u: UserCommandInput): string {
  const fields: [string, string][] = [
    ["PIN", u.pin],
    ["Name", safeField(u.name)],
    ["Pri", String(u.privilege ?? 0)],
    ["Passwd", u.password ?? ""],
    ["Card", u.card ?? ""],
    ["Grp", u.group || "1"],
    ["TZ", "0000000000000000"],
    ["Verify", u.verify || "-1"],
  ];
  return `DATA UPDATE USERINFO ${fields.map(([k, v]) => `${k}=${v}`).join("\t")}`;
}

/** Also removes the user's fingerprints, face and photo from the machine. */
export function cmdDeleteUser(pin: string): string {
  return `DATA DELETE USERINFO PIN=${pin}`;
}

/** Without FID: all of this user's fingers. */
export function cmdDeleteFingers(pin: string): string {
  return `DATA DELETE FINGERTMP PIN=${pin}`;
}

/** Ask the machine to upload this user's fingerprint templates (backup before blocking). */
export function cmdQueryFingers(pin: string): string {
  return `DATA QUERY FINGERTMP PIN=${pin}`;
}

export function cmdUpdateFinger(fp: FingerTemplate): string {
  return `DATA UPDATE FINGERTMP PIN=${fp.pin}\tFID=${fp.fid}\tSize=${fp.size}\tValid=${fp.valid}\tTMP=${fp.template}`;
}

/** Remote enrolment: the machine prompts the member to place the finger 3 times. */
export function cmdEnrollFinger(pin: string, fid: number): string {
  return `ENROLL_FP PIN=${pin}\tFID=${fid}\tRETRY=3\tOVERWRITE=1`;
}

/**
 * Personal short message (TAG=254) bound to one user. The machine shows it when that user is
 * identified; `minutes` is how long it stays valid. One message slot (UID) per member.
 */
export function cmdUserMessage(
  pin: string,
  uid: number,
  text: string,
  startTime: string,
  minutes = 60 * 24
): string[] {
  return [
    `DATA UPDATE SMS MSG=${safeField(text, 60)}\tTAG=254\tUID=${uid}\tMIN=${minutes}\tStartTime=${startTime}`,
    `DATA UPDATE USER_SMS PIN=${pin}\tUID=${uid}`,
  ];
}

export function cmdDeleteMessage(uid: number): string {
  return `DATA DELETE SMS UID=${uid}`;
}

/** Message slot ids come from the member code so each member owns one slot. */
export function messageUid(pin: string): number {
  return Number(pin);
}

export function cmdQueryAttLog(from: string, to: string): string {
  return `DATA QUERY ATTLOG StartTime=${from}\tEndTime=${to}`;
}

export const SIMPLE_COMMANDS = {
  info: "INFO",
  check: "CHECK",
  reboot: "REBOOT",
  unlock: "AC_UNLOCK",
} as const;

/** Return codes from the protocol's Appendix 1 (and ENROLL_FP's own codes). */
export function describeReturn(code: number | null, kind?: string): string {
  if (code === null) return "";
  if (kind === "enroll") {
    const enroll: Record<number, string> = {
      0: "Enrolled",
      2: "Finger already enrolled",
      4: "Poor quality, try again",
      5: "Fingerprint already belongs to someone",
      6: "Cancelled on the machine",
      7: "Machine busy",
    };
    if (enroll[code]) return enroll[code]!;
  }
  const codes: Record<number, string> = {
    0: "OK",
    [-1]: "Bad parameter",
    [-3]: "Read/write error on the machine",
    [-9]: "Template size mismatch",
    [-10]: "User not on the machine",
    [-11]: "Bad fingerprint template",
    [-12]: "Bad fingerprint template",
    [-1001]: "Machine memory full",
    [-1002]: "Not supported by this machine",
    [-1003]: "Timed out",
    [-1004]: "Data inconsistent",
    [-1005]: "Machine busy",
  };
  return codes[code] ?? `Machine error ${code}`;
}
