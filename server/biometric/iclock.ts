// HTTP side of the eSSL / ZKTeco ADMS push protocol, mounted at /iclock/* (server/_core/index.ts).
// The machine only understands short plain-text replies.

import express, { type Express, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  deviceCommands,
  deviceLog,
  devices,
  deviceUsers,
  fingerprintTemplates,
} from "../../drizzle/schema";
import {
  handshakeResponse,
  parseAttLog,
  parseCommandResults,
  parseInfoParam,
  parseKv,
  parseOperLog,
} from "./adms";
import {
  getBiometricSettings,
  reconcileDevices,
  recordPunch,
  renderCommand,
  requireDb,
  runDailyJobs,
  storeHistory,
  type Db,
  type Punch,
} from "./engine";
import { addDays, deviceTimeToDate, todayIST } from "./rules";

/** India +5:30 in minutes (PUSH protocol: values beyond +/-60 are minutes). */
const timeZone = () => process.env.ADMS_TIMEZONE ?? "330";

/** Full re-check of members against a machine at most this often (ms), driven by its polling. */
const RECONCILE_EVERY_MS = 15_000;
const lastReconcile = new Map<string, number>();

interface DeviceRow {
  sn: string;
  status: "pending" | "active" | "disabled";
  attStamp: string | null;
  opStamp: string | null;
}

function reply(res: Response, body: string, status = 200) {
  res
    .status(status)
    .set({
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      date: new Date().toUTCString(),
    })
    .send(body);
}

async function touchDevice(
  db: Db,
  sn: string,
  req: Request
): Promise<DeviceRow> {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ||
    req.socket.remoteAddress ||
    null;
  const pushver =
    typeof req.query["pushver"] === "string" ? req.query["pushver"] : null;
  await db
    .insert(devices)
    .values({ sn, lastSeenAt: new Date(), lastIp: ip, pushVersion: pushver })
    .onConflictDoUpdate({
      target: devices.sn,
      // Keep the stored IP / protocol version when this request does not report one.
      set: {
        lastSeenAt: new Date(),
        ...(ip ? { lastIp: ip } : {}),
        ...(pushver ? { pushVersion: pushver } : {}),
      },
    });
  const [row] = await db
    .select()
    .from(devices)
    .where(eq(devices.sn, sn))
    .limit(1);
  return row!;
}

async function mergeInfo(db: Db, sn: string, info: Record<string, string>) {
  const [row] = await db
    .select({ info: devices.info })
    .from(devices)
    .where(eq(devices.sn, sn))
    .limit(1);
  let old: Record<string, string> = {};
  try {
    old = row?.info ? JSON.parse(row.info) : {};
  } catch {
    old = {};
  }
  await db
    .update(devices)
    .set({ info: JSON.stringify({ ...old, ...info }) })
    .where(eq(devices.sn, sn));
}

async function cdata(
  db: Db,
  device: DeviceRow,
  req: Request,
  body: string
): Promise<string | [string, number]> {
  const settings = await getBiometricSettings(db);
  if (req.method === "GET") {
    if (req.query["options"])
      return handshakeResponse({
        sn: device.sn,
        attStamp: device.attStamp,
        opStamp: device.opStamp,
        delaySeconds: settings.machine.pollSeconds,
        timeZone: timeZone(),
      });
    return "OK";
  }
  // Data from a machine the owner has not approved is refused (not dropped): the machine keeps
  // it and uploads again after approval.
  if (device.status !== "active")
    return [
      device.status === "pending"
        ? "Machine waiting for approval in the gym software"
        : "Machine disabled",
      403,
    ];

  const table = String(req.query["table"] ?? "").toUpperCase();
  const stamp = (req.query["Stamp"] ?? req.query["OpStamp"]) as
    | string
    | undefined;
  if (table === "ATTLOG") {
    const rows = parseAttLog(body);
    const recentFrom = addDays(todayIST(), -1);
    const history: Punch[] = [];
    for (const r of rows) {
      const at = deviceTimeToDate(r.time);
      if (!at) continue;
      const punch = {
        pin: r.pin,
        at,
        date: r.time.slice(0, 10),
        verify: r.verify,
        status: r.status,
      };
      if (punch.date >= recentFrom)
        await recordPunch(db, device.sn, punch, settings);
      else history.push(punch);
    }
    if (history.length) await storeHistory(db, device.sn, history);
    if (stamp)
      await db
        .update(devices)
        .set({ attStamp: String(stamp) })
        .where(eq(devices.sn, device.sn));
    return `OK: ${rows.length}`;
  }
  if (table === "OPERLOG") {
    const records = parseOperLog(body);
    for (const r of records) {
      if (r.type === "user") {
        const u = r.user;
        const row = {
          name: u.name.slice(0, 80),
          privilege: u.privilege,
          card: u.card || null,
          password: u.password || null,
          grp: u.group || null,
          verify: u.verify || null,
        };
        await db
          .insert(deviceUsers)
          .values({ deviceSn: device.sn, pin: u.pin, ...row })
          .onConflictDoUpdate({
            target: [deviceUsers.deviceSn, deviceUsers.pin],
            set: row,
          });
      } else if (r.type === "fp") {
        const f = r.fp;
        const row = {
          template: f.template,
          size: f.size,
          valid: f.valid,
          sourceSn: device.sn,
        };
        await db
          .insert(fingerprintTemplates)
          .values({ pin: f.pin, fid: f.fid, ...row })
          .onConflictDoUpdate({
            target: [fingerprintTemplates.pin, fingerprintTemplates.fid],
            set: row,
          });
        const count = sql`(select count(*) from gym_fingerprint_templates t where t.pin = ${f.pin})`;
        await db
          .insert(deviceUsers)
          .values({ deviceSn: device.sn, pin: f.pin, fingerprints: 1 })
          .onConflictDoUpdate({
            target: [deviceUsers.deviceSn, deviceUsers.pin],
            set: { fingerprints: count },
          });
      }
    }
    if (stamp)
      await db
        .update(devices)
        .set({ opStamp: String(stamp) })
        .where(eq(devices.sn, device.sn));
    return `OK: ${records.length}`;
  }
  if (table === "OPTIONS" || table === "INFO")
    await mergeInfo(db, device.sn, parseKv(body.replace(/\r?\n/g, ","), ","));
  // ATTPHOTO and anything newer: acknowledge so the machine does not resend forever.
  return "OK";
}

async function getrequest(
  db: Db,
  device: DeviceRow,
  req: Request
): Promise<string> {
  const info = parseInfoParam(
    typeof req.query["INFO"] === "string" ? req.query["INFO"] : null
  );
  if (info) await mergeInfo(db, device.sn, info);
  if (device.status !== "active") return "OK";

  // The machine's polling drives the daily job (expiries, alerts) and keeps access in line with
  // any change made in the app (renewals, payments, freezes) within seconds.
  await runDailyJobs(db).catch(e =>
    console.error("[biometric] daily jobs failed", e)
  );
  if (Date.now() - (lastReconcile.get(device.sn) ?? 0) > RECONCILE_EVERY_MS) {
    lastReconcile.set(device.sn, Date.now());
    await reconcileDevices(db, { sn: device.sn, reason: "poll" }).catch(e =>
      console.error("[biometric] sync failed", e)
    );
  }

  // Commands sent but never answered (machine restarted) go out again, up to 3 tries.
  // sentAt/notBefore are stored with their time zone, so now() compares them exactly.
  await db.execute(
    sql`update gym_device_commands
        set status = (case when attempts >= 3 then 'failed' else 'queued' end)::device_command_status
        where "deviceSn" = ${device.sn} and status = 'sent' and "sentAt" < now() - interval '3 minutes'`
  );
  const queued = (
    await db.execute<{
      id: number;
      command: string;
      pin: number | null;
      name: string | null;
    }>(
      sql`select c.id, c.command, b.pin, m.name from gym_device_commands c
          left join gym_biometric_members b on b."memberId" = c."memberId"
          left join gym_members m on m.id = c."memberId"
          where c."deviceSn" = ${device.sn} and c.status = 'queued' and (c."notBefore" is null or c."notBefore" <= now())
          order by c.id limit 60`
    )
  ).rows;
  const lines: string[] = [];
  let bytes = 0;
  for (const c of queued) {
    const text = await renderCommand(
      db,
      device.sn,
      c.command,
      c.pin === null ? null : { pin: c.pin, name: c.name ?? "" }
    );
    // Keep each reply small (fingerprint templates are ~2 KB); the rest goes on the next poll.
    if (lines.length > 0 && bytes + text.length > 30_000) break;
    lines.push(`C:${c.id}:${text}`);
    bytes += text.length + 16;
    await db
      .update(deviceCommands)
      .set({
        status: "sent",
        sentAt: new Date(),
        attempts: sql`attempts + 1`,
        command: text,
      })
      .where(eq(deviceCommands.id, c.id));
  }
  return lines.length ? lines.join("\n") : "OK";
}

async function devicecmd(
  db: Db,
  device: DeviceRow,
  body: string
): Promise<string> {
  for (const r of parseCommandResults(body)) {
    await db
      .update(deviceCommands)
      .set({
        status: r.returnCode === 0 ? "done" : "failed",
        returnCode: r.returnCode,
        doneAt: new Date(),
      })
      .where(
        sql`${deviceCommands.id} = ${r.id} and ${deviceCommands.deviceSn} = ${device.sn}`
      );
  }
  if (/CMD=INFO/i.test(body)) {
    const kv: Record<string, string> = {};
    for (const line of body.split(/\r?\n/).slice(1)) {
      const i = line.indexOf("=");
      if (i > 0)
        kv[line.slice(0, i).replace(/^~/, "").trim()] = line
          .slice(i + 1)
          .trim();
    }
    if (Object.keys(kv).length) await mergeInfo(db, device.sn, kv);
  }
  return "OK";
}

export async function handleIclock(req: Request, res: Response) {
  const sn = String(req.query["SN"] ?? req.query["sn"] ?? "").trim();
  const endpoint = req.path
    .replace(/^\/+/, "")
    .replace(/\.aspx$/i, "")
    .toLowerCase();
  const body = typeof req.body === "string" ? req.body : "";
  if (!sn || sn.length > 64 || !/^[\w.-]+$/.test(sn))
    return reply(res, "Missing SN", 400);
  let db: Db;
  try {
    db = await requireDb();
  } catch {
    return reply(res, "ERROR", 503);
  }
  let out: string | [string, number];
  try {
    const device = await touchDevice(db, sn, req);
    if (endpoint === "cdata") out = await cdata(db, device, req, body);
    else if (endpoint === "getrequest") out = await getrequest(db, device, req);
    else if (endpoint === "devicecmd") out = await devicecmd(db, device, body);
    else out = "OK"; // ping, registry, push and other newer endpoints
  } catch (e) {
    console.error("[biometric] iclock error", e);
    out = ["ERROR", 500];
  }
  const [text, status] = typeof out === "string" ? [out, 200] : out;
  reply(res, text, status);
  if (!(endpoint === "getrequest" && text === "OK")) {
    await db
      .insert(deviceLog)
      .values({
        deviceSn: sn,
        method: req.method,
        path: req.path.slice(0, 120),
        query: req.originalUrl.split("?")[1]?.slice(0, 500) ?? "",
        body: body.slice(0, 2000),
        response: text.slice(0, 1000),
      })
      .catch(() => undefined);
  }
}

/** Mount before the JSON/urlencoded parsers so the machine's plain-text bodies arrive intact. */
export function registerIclockRoutes(app: Express) {
  app.use(
    "/iclock",
    express.text({ type: () => true, limit: "20mb" }),
    (req, res) => {
      void handleIclock(req, res);
    }
  );
}
