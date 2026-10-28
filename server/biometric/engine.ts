// Fingerprint machine engine: keeps each eSSL machine in line with the gym's membership data.
//
// Inbound: punches become the gym's normal check-ins (method "biometric") plus a punch log for
// the gate screen; uploaded users and fingerprints are mirrored and backed up.
// Outbound: for every member linked to a machine User ID, the access rule decides what the
// machine should hold; only differences are queued as commands, which the machine collects on
// its next poll. Members not linked in the software (trainers, the owner, old users) are never
// touched.

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  attendance,
  auditLogs,
  biometricConfig,
  biometricMembers,
  biometricPunches,
  deviceCommands,
  deviceUsers,
  fingerprintTemplates,
  memberAlerts,
  memberDeviceState,
  members,
  memberships,
  payments,
} from "../../drizzle/schema";
import { affectedRows, getDb, getGymSettings } from "../db";
import { BRAND } from "@shared/brand";
import {
  cmdDeleteFingers,
  cmdDeleteUser,
  cmdEnrollFinger,
  cmdQueryAttLog,
  cmdQueryFingers,
  cmdUpdateFinger,
  cmdUpdateUser,
  cmdUserMessage,
  messageUid,
  SIMPLE_COMMANDS,
} from "./adms";
import {
  accessState,
  addDays,
  dailyAlerts,
  dateToDeviceTime,
  DEFAULT_BIOMETRIC_SETTINGS,
  desiredOnDevice,
  formatDate,
  mergeBiometricSettings,
  renderTemplate,
  todayIST,
  waNumber,
  type AccessState,
  type AlertKind,
  type BiometricSettings,
  type BlockMode,
  type DesiredOnDevice,
  type ISODate,
  type TemplateVars,
  type TermFacts,
} from "./rules";

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Exec = Db | Tx;

export async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new Error("Gym database is unavailable.");
  return db;
}

/** Actor id used in audit logs and attendance for things the machine/system does. */
export const SYSTEM_ACTOR = 0;

// ---------------------------------------------------------------- settings

export async function getBiometricSettings(
  db: Exec
): Promise<BiometricSettings> {
  const [row] = await db
    .select()
    .from(biometricConfig)
    .where(eq(biometricConfig.id, 1))
    .limit(1);
  if (!row) return DEFAULT_BIOMETRIC_SETTINGS;
  try {
    return mergeBiometricSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_BIOMETRIC_SETTINGS;
  }
}

export async function saveBiometricSettings(db: Exec, s: BiometricSettings) {
  await db
    .insert(biometricConfig)
    .values({ id: 1, value: JSON.stringify(s) })
    .onConflictDoUpdate({
      target: biometricConfig.id,
      set: { value: JSON.stringify(s) },
    });
}

// ---------------------------------------------------------------- member states

export interface MemberEntry {
  memberId: number;
  memberCode: string;
  name: string;
  phone: string;
  dob: ISODate | null;
  status: "active" | "inactive" | "frozen";
  pin: number | null;
  override: "allow" | "block" | null;
  terms: (TermFacts & { createdAt: Date })[];
  state: AccessState;
}

/**
 * Members with their access state for `today`. With `linkedOnly`, only members that have a
 * machine User ID. Uses the same tables the rest of the app writes, so any renewal, payment,
 * freeze or status change made anywhere in the app is picked up.
 */
export async function loadMemberEntries(
  db: Exec,
  opts: {
    memberIds?: number[];
    linkedOnly?: boolean;
    today?: ISODate;
    expiringWindowDays?: number;
  } = {}
): Promise<MemberEntry[]> {
  const today = opts.today ?? todayIST();
  if (opts.memberIds && opts.memberIds.length === 0) return [];
  const memberRows = await db
    .select({
      id: members.id,
      memberCode: members.memberCode,
      name: members.name,
      phone: members.phone,
      dob: members.dateOfBirth,
      status: members.status,
      pin: biometricMembers.pin,
      override: biometricMembers.override,
    })
    .from(members)
    .leftJoin(biometricMembers, eq(biometricMembers.memberId, members.id))
    .where(
      and(
        opts.memberIds ? inArray(members.id, opts.memberIds) : undefined,
        opts.linkedOnly ? isNotNull(biometricMembers.pin) : undefined
      )
    );
  if (memberRows.length === 0) return [];
  const ids = memberRows.map(m => m.id);
  const termRows = await db
    .select({
      id: memberships.id,
      memberId: memberships.memberId,
      planName: memberships.planName,
      startDate: memberships.startDate,
      endDate: memberships.endDate,
      status: memberships.status,
      planPrice: memberships.planPrice,
      discount: memberships.discount,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .where(inArray(memberships.memberId, ids));
  const paidRows = termRows.length
    ? await db
        .select({
          membershipId: payments.membershipId,
          paid: sql<string>`COALESCE(SUM(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.status, "posted"),
            inArray(
              payments.membershipId,
              termRows.map(t => t.id)
            )
          )
        )
        .groupBy(payments.membershipId)
    : [];
  const paidBy = new Map(paidRows.map(p => [p.membershipId, Number(p.paid)]));
  const termsBy = new Map<number, MemberEntry["terms"]>();
  for (const t of termRows) {
    const list = termsBy.get(t.memberId) ?? [];
    list.push({
      id: t.id,
      planName: t.planName,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      fee: t.planPrice - t.discount,
      paid: paidBy.get(t.id) ?? 0,
      createdAt: t.createdAt,
    });
    termsBy.set(t.memberId, list);
  }
  return memberRows.map(m => {
    const terms = termsBy.get(m.id) ?? [];
    return {
      memberId: m.id,
      memberCode: m.memberCode,
      name: m.name,
      phone: m.phone,
      dob: m.dob,
      status: m.status,
      pin: m.pin ?? null,
      override: m.override ?? null,
      terms,
      state: accessState(
        {
          id: m.id,
          name: m.name,
          status: m.status,
          override: m.override ?? null,
        },
        terms,
        today,
        opts.expiringWindowDays
      ),
    };
  });
}

async function expiringWindow(): Promise<number> {
  const s = await getGymSettings().catch(() => undefined);
  return s?.expiryAlertDays ?? 7;
}

// ---------------------------------------------------------------- outbound commands

export interface QueuedCommand {
  command: string;
  kind: string;
  /** Hold back this many seconds (lets a fingerprint backup arrive before a block). */
  delaySeconds?: number;
}

/** Seconds a block waits after asking the machine for a fingerprint backup. */
export const BACKUP_WAIT_SECONDS = 90;

/**
 * User records are queued as markers and written out when the machine collects them
 * (renderCommand), so they always carry the latest privilege, card, keypad password, group and
 * verify mode the machine reported; fields sent empty are cleared on the machine.
 *   @USERINFO:allow:<blocked group>   normal access
 *   @USERINFO:clear                   blocked: card and keypad password taken off (held)
 *   @USERINFO:group:<n>               blocked: moved to access group n
 */
export const USER_MARKER = "@USERINFO:";

type Template = {
  fid: number;
  size: number | null;
  valid: number | null;
  template: string;
};

export function commandsFor(
  pin: string,
  want: DesiredOnDevice,
  opts: {
    restoreFingers: Template[] | null;
    hasBackup: boolean;
    blockedGroup: number;
  }
): QueuedCommand[] {
  const cmds: QueuedCommand[] = [];
  if (want.allowed) {
    cmds.push({
      command: `${USER_MARKER}allow:${opts.blockedGroup}`,
      kind: "user_allow",
    });
    for (const fp of opts.restoreFingers ?? [])
      cmds.push({
        command: cmdUpdateFinger({
          pin,
          fid: fp.fid,
          size: fp.size ?? fp.template.length,
          valid: fp.valid ?? 1,
          template: fp.template,
        }),
        kind: "finger_restore",
      });
  } else if (want.blockMode === "group") {
    cmds.push({
      command: `${USER_MARKER}group:${opts.blockedGroup}`,
      kind: "user_block",
    });
  } else {
    const delay = opts.hasBackup ? 0 : BACKUP_WAIT_SECONDS;
    if (!opts.hasBackup)
      cmds.push({ command: cmdQueryFingers(pin), kind: "finger_backup" });
    if (want.blockMode === "remove") {
      cmds.push({
        command: cmdDeleteUser(pin),
        kind: "user_remove",
        delaySeconds: delay,
      });
    } else {
      // Card and keypad password would still open the door, so they come off too.
      cmds.push({
        command: `${USER_MARKER}clear`,
        kind: "user_block",
        delaySeconds: delay,
      });
      cmds.push({
        command: cmdDeleteFingers(pin),
        kind: "user_block",
        delaySeconds: delay,
      });
    }
  }
  if (want.present && want.message) {
    for (const c of cmdUserMessage(
      pin,
      messageUid(pin),
      want.message,
      dateToDeviceTime(new Date())
    ))
      cmds.push({ command: c, kind: "message" });
  }
  return cmds;
}

/** Turn a queued command into the exact text sent to the machine. */
export async function renderCommand(
  db: Exec,
  sn: string,
  command: string,
  member: { pin: number; name: string } | null
): Promise<string> {
  if (!command.startsWith(USER_MARKER) || !member) return command;
  const [mode, arg] = command.slice(USER_MARKER.length).split(":");
  const pin = String(member.pin);
  const [m] = await db
    .select()
    .from(deviceUsers)
    .where(and(eq(deviceUsers.deviceSn, sn), eq(deviceUsers.pin, pin)))
    .limit(1);
  const user = {
    pin,
    name: member.name,
    privilege: m?.privilege ?? 0,
    card: m?.card || m?.heldCard || "",
    password: m?.password || m?.heldPassword || "",
    group: m?.grp ?? "1",
    verify: m?.verify ?? "-1",
  };
  if (mode === "clear") {
    if (m)
      await db
        .update(deviceUsers)
        .set({
          heldCard: m.card || m.heldCard,
          heldPassword: m.password || m.heldPassword,
        })
        .where(and(eq(deviceUsers.deviceSn, sn), eq(deviceUsers.pin, pin)));
    return cmdUpdateUser({ ...user, card: "", password: "" });
  }
  if (mode === "group") return cmdUpdateUser({ ...user, group: arg ?? "2" });
  if (m && (m.heldCard || m.heldPassword))
    // They go back onto the machine with this record, so the mirror gets them back too.
    await db
      .update(deviceUsers)
      .set({
        card: m.card || m.heldCard,
        password: m.password || m.heldPassword,
        heldCard: null,
        heldPassword: null,
      })
      .where(and(eq(deviceUsers.deviceSn, sn), eq(deviceUsers.pin, pin)));
  return cmdUpdateUser({
    ...user,
    group: user.group === arg ? "1" : user.group,
  });
}

async function enqueue(
  db: Exec,
  sn: string,
  cmds: QueuedCommand[],
  memberId: number | null,
  extraDelay = 0
) {
  for (const c of cmds) {
    const delay = (c.delaySeconds ?? 0) + extraDelay;
    await db.insert(deviceCommands).values({
      deviceSn: sn,
      command: c.command,
      kind: c.kind,
      memberId,
      notBefore: delay > 0 ? new Date(Date.now() + delay * 1000) : null,
    });
  }
}

interface LastState {
  present: boolean;
  allowed: boolean;
  blockMode: string | null;
  message: string | null;
}

/** Facts about one machine, loaded once per sync instead of per member. */
interface DeviceFacts {
  last: Map<number, LastState>;
  admins: Set<string>;
  backups: Map<string, number>;
}

async function deviceFacts(db: Exec, sn: string): Promise<DeviceFacts> {
  const last = await db
    .select()
    .from(memberDeviceState)
    .where(eq(memberDeviceState.deviceSn, sn));
  const admins = await db
    .select({ pin: deviceUsers.pin })
    .from(deviceUsers)
    .where(
      and(eq(deviceUsers.deviceSn, sn), sql`${deviceUsers.privilege} > 0`)
    );
  const backups = await db
    .select({ pin: fingerprintTemplates.pin, n: sql<string>`COUNT(*)` })
    .from(fingerprintTemplates)
    .groupBy(fingerprintTemplates.pin);
  return {
    last: new Map(last.map(r => [r.memberId, r])),
    admins: new Set(admins.map(r => r.pin)),
    backups: new Map(backups.map(r => [r.pin, Number(r.n)])),
  };
}

async function applyMember(
  db: Exec,
  sn: string,
  entry: MemberEntry,
  s: BiometricSettings,
  facts: DeviceFacts,
  opts: { force?: boolean; delaySeconds?: number } = {}
): Promise<"queued" | "same"> {
  if (entry.pin === null) return "same";
  const pin = String(entry.pin);
  let want = desiredOnDevice(entry.name, entry.state, s.machine);
  // Never lock a machine administrator out of the machine (that is how the owner gets into its menu).
  if (facts.admins.has(pin) && !want.allowed)
    want = { present: true, allowed: true, blockMode: null, message: null };
  const last = facts.last.get(entry.memberId);
  const same =
    last &&
    last.present === want.present &&
    last.allowed === want.allowed &&
    (last.blockMode ?? null) === want.blockMode &&
    (last.message ?? null) === want.message;
  if (same && !opts.force) return "same";
  const restore =
    want.allowed &&
    !!last &&
    !last.allowed &&
    (last.blockMode === "fingers" || last.blockMode === "remove");
  const fingers = restore
    ? await db
        .select({
          fid: fingerprintTemplates.fid,
          size: fingerprintTemplates.size,
          valid: fingerprintTemplates.valid,
          template: fingerprintTemplates.template,
        })
        .from(fingerprintTemplates)
        .where(eq(fingerprintTemplates.pin, pin))
    : null;
  // Older unsent commands for this member are replaced by the latest state.
  await db
    .update(deviceCommands)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(deviceCommands.deviceSn, sn),
        eq(deviceCommands.memberId, entry.memberId),
        eq(deviceCommands.status, "queued"),
        sql`${deviceCommands.kind} <> 'enroll'`
      )
    );
  await enqueue(
    db,
    sn,
    commandsFor(pin, want, {
      restoreFingers: fingers,
      hasBackup: (facts.backups.get(pin) ?? 0) > 0,
      blockedGroup: s.machine.blockedGroup,
    }),
    entry.memberId,
    opts.delaySeconds ?? 0
  );
  const row = {
    present: want.present,
    allowed: want.allowed,
    blockMode: want.blockMode as BlockMode | null,
    message: want.message,
    appliedAt: new Date(),
  };
  await db
    .insert(memberDeviceState)
    .values({ deviceSn: sn, memberId: entry.memberId, ...row })
    .onConflictDoUpdate({
      target: [memberDeviceState.deviceSn, memberDeviceState.memberId],
      set: row,
    });
  facts.last.set(entry.memberId, row);
  return "queued";
}

async function activeDeviceSns(db: Exec, only?: string): Promise<string[]> {
  const rows = await db.execute<{ sn: string }>(
    sql`select sn from gym_devices where status = 'active' ${only ? sql`and sn = ${only}` : sql``} order by "createdAt"`
  );
  return rows.rows.map(r => r.sn);
}

/** Bring one machine (or all) in line with every linked member. Cheap when nothing changed. */
export async function reconcileDevices(
  db: Db,
  opts: { sn?: string; force?: boolean; delaySeconds?: number; reason: string }
) {
  const s = await getBiometricSettings(db);
  const entries = await loadMemberEntries(db, {
    linkedOnly: true,
    expiringWindowDays: await expiringWindow(),
  });
  let queued = 0;
  let blocked = 0;
  const sns = await activeDeviceSns(db, opts.sn);
  for (const sn of sns) {
    const facts = await deviceFacts(db, sn);
    for (const e of entries) {
      if ((await applyMember(db, sn, e, s, facts, opts)) === "queued") queued++;
      if (!(facts.last.get(e.memberId)?.allowed ?? true)) blocked++;
    }
  }
  if (queued > 0 || opts.force)
    await db
      .insert(auditLogs)
      .values({
        actorId: SYSTEM_ACTOR,
        action: "biometric.sync",
        entityType: "device",
        reason: `${opts.reason}: ${queued} update(s), ${blocked} blocked`.slice(
          0,
          1000
        ),
      });
  return { devices: sns.length, members: entries.length, queued, blocked };
}

export async function syncMember(db: Db, memberId: number, force = false) {
  const s = await getBiometricSettings(db);
  const [entry] = await loadMemberEntries(db, {
    memberIds: [memberId],
    linkedOnly: true,
    expiringWindowDays: await expiringWindow(),
  });
  if (!entry) return;
  for (const sn of await activeDeviceSns(db))
    await applyMember(db, sn, entry, s, await deviceFacts(db, sn), { force });
}

export type MachineCommand =
  | keyof typeof SIMPLE_COMMANDS
  | "upload_all"
  | "upload_logs";

export async function queueDeviceCommand(
  db: Db,
  sn: string,
  kind: MachineCommand
) {
  if (kind === "upload_all") {
    // Stamps back to zero + CHECK: the machine uploads every user, fingerprint and punch it holds.
    await db.execute(
      sql`update gym_devices set "opStamp" = '0', "attStamp" = '0' where sn = ${sn}`
    );
    await enqueue(
      db,
      sn,
      [{ command: SIMPLE_COMMANDS.check, kind: "upload_all" }],
      null
    );
    return;
  }
  if (kind === "upload_logs") {
    const now = new Date();
    await enqueue(
      db,
      sn,
      [
        {
          command: cmdQueryAttLog(
            `${addDays(todayIST(now), -7)} 00:00:00`,
            dateToDeviceTime(now)
          ),
          kind,
        },
      ],
      null
    );
    return;
  }
  await enqueue(db, sn, [{ command: SIMPLE_COMMANDS[kind], kind }], null);
}

/** Lowest free machine User ID from 1001, avoiding IDs already on any machine. */
export async function nextFreePin(db: Exec): Promise<number> {
  const linked = await db
    .select({ pin: biometricMembers.pin })
    .from(biometricMembers);
  const onDevice = await db.select({ pin: deviceUsers.pin }).from(deviceUsers);
  const used = new Set<number>([
    ...linked.map(r => r.pin),
    ...onDevice.map(r => Number(r.pin)).filter(Number.isFinite),
  ]);
  let pin = 1001;
  while (used.has(pin)) pin++;
  return pin;
}

export async function linkMember(
  db: Db,
  memberId: number,
  pin: number,
  actorId: number
) {
  if (!Number.isInteger(pin) || pin < 1 || pin > 999999999)
    throw new Error("Machine User ID must be a whole number");
  const [taken] = await db
    .select()
    .from(biometricMembers)
    .where(eq(biometricMembers.pin, pin))
    .limit(1);
  if (taken && taken.memberId !== memberId)
    throw new Error(
      `Machine User ID ${pin} is already linked to another member`
    );
  await db
    .insert(biometricMembers)
    .values({ memberId, pin })
    .onConflictDoUpdate({ target: biometricMembers.memberId, set: { pin } });
  await db
    .insert(auditLogs)
    .values({
      actorId,
      action: "biometric.link",
      entityType: "member",
      entityId: memberId,
      reason: `Machine User ID ${pin}`,
    });
  await syncMember(db, memberId, true);
}

export async function unlinkMember(db: Db, memberId: number, actorId: number) {
  await db
    .delete(biometricMembers)
    .where(eq(biometricMembers.memberId, memberId));
  await db
    .delete(memberDeviceState)
    .where(eq(memberDeviceState.memberId, memberId));
  await db
    .update(deviceCommands)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(deviceCommands.memberId, memberId),
        eq(deviceCommands.status, "queued")
      )
    );
  await db
    .insert(auditLogs)
    .values({
      actorId,
      action: "biometric.unlink",
      entityType: "member",
      entityId: memberId,
    });
}

export async function setOverride(
  db: Db,
  memberId: number,
  override: "allow" | "block" | null,
  actorId: number
) {
  const [link] = await db
    .select()
    .from(biometricMembers)
    .where(eq(biometricMembers.memberId, memberId))
    .limit(1);
  if (!link) throw new Error("Link the member to a machine User ID first");
  await db
    .update(biometricMembers)
    .set({ override })
    .where(eq(biometricMembers.memberId, memberId));
  await db
    .insert(auditLogs)
    .values({
      actorId,
      action: "biometric.override",
      entityType: "member",
      entityId: memberId,
      reason: override ?? "follow membership",
    });
  await syncMember(db, memberId);
}

export async function queueEnroll(
  db: Db,
  sn: string,
  memberId: number,
  finger: number,
  actorId: number
) {
  const [device] = await db
    .execute<{ status: string }>(sql`select status from gym_devices where sn = ${sn}`)
    .then(r => r.rows);
  if (device?.status !== "active")
    throw new Error("That machine is not connected");
  let [link] = await db
    .select()
    .from(biometricMembers)
    .where(eq(biometricMembers.memberId, memberId))
    .limit(1);
  if (!link) {
    await linkMember(db, memberId, await nextFreePin(db), actorId);
    [link] = await db
      .select()
      .from(biometricMembers)
      .where(eq(biometricMembers.memberId, memberId))
      .limit(1);
  }
  // The user must exist on the machine before a finger can be enrolled for them.
  await syncMember(db, memberId, true);
  await enqueue(
    db,
    sn,
    [{ command: cmdEnrollFinger(String(link!.pin), finger), kind: "enroll" }],
    memberId
  );
  await db
    .insert(auditLogs)
    .values({
      actorId,
      action: "biometric.enroll",
      entityType: "member",
      entityId: memberId,
      reason: `Machine ${sn}, finger ${finger}`,
    });
  return link!.pin;
}

// ---------------------------------------------------------------- inbound punches

export interface Punch {
  pin: string;
  at: Date;
  date: ISODate;
  verify: number;
  status: number;
}

/**
 * Store one punch with the access decision at that moment. Allowed punches become the gym's
 * normal check-in (one per day); a later punch checks the member out; blocked members get a
 * "blocked at the door" alert.
 */
export async function recordPunch(
  db: Db,
  sn: string,
  punch: Punch,
  s: BiometricSettings
) {
  const pinNum = /^\d+$/.test(punch.pin) ? Number(punch.pin) : null;
  const [link] =
    pinNum === null
      ? []
      : await db
          .select()
          .from(biometricMembers)
          .where(eq(biometricMembers.pin, pinNum))
          .limit(1);
  const [entry] = link
    ? await loadMemberEntries(db, {
        memberIds: [link.memberId],
        today: punch.date,
        expiringWindowDays: await expiringWindow(),
      })
    : [];
  const state = entry?.state ?? null;
  const recent = entry
    ? await db
        .select({ punchedAt: biometricPunches.punchedAt })
        .from(biometricPunches)
        .where(
          and(
            eq(biometricPunches.memberId, entry.memberId),
            eq(biometricPunches.punchDate, punch.date),
            eq(biometricPunches.duplicate, false)
          )
        )
    : [];
  const duplicate = recent.some(r => {
    const gap = punch.at.getTime() - r.punchedAt.getTime();
    return gap >= 0 && gap <= s.machine.duplicateMinutes * 60_000;
  });
  const inserted = await db
    .insert(biometricPunches)
      .values({
      deviceSn: sn,
      pin: punch.pin,
      memberId: entry?.memberId ?? null,
      punchedAt: punch.at,
      punchDate: punch.date,
      verifyType: punch.verify,
      punchState: punch.status,
      allowed: state?.allowed ?? null,
      reason: state?.reason ?? "unknown_user",
      headline: (state?.headline ?? "Not linked in the software").slice(0, 160),
      duplicate,
    })
      .onConflictDoNothing();
  if (!affectedRows(inserted) || !entry || !state) return;

  const recentDay = punch.date >= addDays(todayIST(), -1);
  if (state.allowed && !duplicate && recentDay) {
    const [visit] = await db
      .select()
      .from(attendance)
      .where(
        and(
          eq(attendance.memberId, entry.memberId),
          eq(attendance.checkInDate, punch.date)
        )
      )
      .limit(1);
    if (!visit) {
      await db
        .insert(attendance)
      .values({
          memberId: entry.memberId,
          checkInDate: punch.date,
          checkedInAt: punch.at,
          method: "biometric",
          staffId: SYSTEM_ACTOR,
        })
      .onConflictDoNothing();
    } else if (
      s.machine.checkoutAfterMinutes > 0 &&
      !visit.checkedOutAt &&
      punch.at.getTime() - visit.checkedInAt.getTime() >=
        s.machine.checkoutAfterMinutes * 60_000
    ) {
      await db
        .update(attendance)
        .set({ checkedOutAt: punch.at })
        .where(
          and(
            eq(attendance.id, visit.id),
            sql`${attendance.checkedOutAt} IS NULL`
          )
        );
    }
  }
  if (
    !state.allowed &&
    punch.date === todayIST() &&
    entry.status !== "inactive"
  ) {
    await raiseAlert(
      db,
      entry,
      "blocked_attempt",
      `blocked:${punch.date}`,
      { status: state.headline.toLowerCase() },
      s
    );
  }
}

/** Old punches (the machine's history on first connection): logged only, quickly. */
export async function storeHistory(db: Db, sn: string, punches: Punch[]) {
  const links = await db.select().from(biometricMembers);
  const byPin = new Map(links.map(l => [String(l.pin), l.memberId]));
  for (let i = 0; i < punches.length; i += 200) {
    const chunk = punches.slice(i, i + 200);
    await db
      .insert(biometricPunches)
      .values(
        chunk.map(p => ({
          deviceSn: sn,
          pin: p.pin,
          memberId: byPin.get(p.pin) ?? null,
          punchedAt: p.at,
          punchDate: p.date,
          verifyType: p.verify,
          punchState: p.status,
          reason: "history",
          headline: "From machine history",
        }))
      )
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------- alerts

export function whatsappMode(): "manual" | "cloud_api" {
  return process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    ? "cloud_api"
    : "manual";
}

async function gymName(): Promise<string> {
  return (
    (await getGymSettings().catch(() => undefined))?.gymName ?? BRAND.name
  );
}

export async function raiseAlert(
  db: Exec,
  entry: MemberEntry,
  kind: AlertKind,
  dedupeKey: string,
  vars: TemplateVars,
  s: BiometricSettings
) {
  if (!s.alerts.enabled[kind]) return false;
  const current = entry.terms.find(
    t => t.status === "active" && t.endDate === entry.state.validUntil
  );
  const message = renderTemplate(s.alerts.templates[kind], {
    gym: await gymName(),
    name: entry.name.split(" ")[0] ?? entry.name,
    fullName: entry.name,
    code: entry.memberCode,
    plan: current?.planName,
    validUntil: formatDate(entry.state.validUntil),
    expiredOn: formatDate(entry.state.expiredOn),
    days: entry.state.daysLeft,
    balance: entry.state.balanceDue,
    ...vars,
  });
  const phone = waNumber(entry.phone);
  const res = await db
    .insert(memberAlerts)
      .values({
      memberId: entry.memberId,
      kind,
      dedupeKey,
      phone,
      message,
      status: phone ? "pending" : "skipped",
      error: phone ? null : "No valid mobile number",
    })
      .onConflictDoNothing();
  return affectedRows(res) > 0;
}

/** Welcome / renewal / receipt messages for plans and payments added in the last 3 days. */
async function eventAlerts(
  db: Db,
  entries: MemberEntry[],
  s: BiometricSettings
): Promise<number> {
  const since = new Date(Date.now() - 3 * 86_400_000);
  let n = 0;
  const byId = new Map(entries.map(e => [e.memberId, e]));
  for (const e of entries) {
    for (const t of e.terms) {
      if (t.status === "cancelled" || t.createdAt < since) continue;
      const first = !e.terms.some(
        o =>
          o.id !== t.id && o.status !== "cancelled" && o.createdAt < t.createdAt
      );
      if (
        await raiseAlert(
          db,
          e,
          first ? "welcome" : "renewed",
          `ms:${t.id}`,
          {
            plan: t.planName,
            start: formatDate(t.startDate),
            validUntil: formatDate(t.endDate),
          },
          s
        )
      )
        n++;
    }
  }
  const recentPayments = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "posted"), gte(payments.recordedAt, since)));
  const modes: Record<string, string> = {
    cash: "cash",
    upi: "UPI",
    bank: "bank transfer",
  };
  for (const p of recentPayments) {
    const e = byId.get(p.memberId);
    if (!e) continue;
    const term = e.terms.find(t => t.id === p.membershipId);
    const balance = term ? Math.max(0, term.fee - term.paid) : 0;
    const vars = {
      amount: p.amount,
      mode: modes[p.mode] ?? p.mode,
      receipt: p.receiptNumber,
      balanceLine: balance > 0 ? `Balance pending: ₹${balance}. ` : "",
    };
    if (await raiseAlert(db, e, "receipt", `pay:${p.id}`, vars, s)) n++;
  }
  return n;
}

/** Queue every alert due today (idempotent). */
export async function runAlerts(db: Db, today = todayIST()) {
  const s = await getBiometricSettings(db);
  const entries = await loadMemberEntries(db, {
    today,
    expiringWindowDays: await expiringWindow(),
  });
  const visits = await db
    .select({
      memberId: attendance.memberId,
      last: sql<string>`MAX(${attendance.checkInDate})`,
    })
    .from(attendance)
    .groupBy(attendance.memberId);
  const lastVisit = new Map(visits.map(v => [v.memberId, v.last]));
  let created = await eventAlerts(db, entries, s);
  for (const e of entries) {
    const current = e.terms.find(
      t => t.status === "active" && t.startDate <= today && today <= t.endDate
    );
    for (const d of dailyAlerts(
      {
        state: e.state,
        dob: e.dob,
        lastVisit: lastVisit.get(e.memberId) ?? null,
        currentStart: current?.startDate ?? null,
      },
      today,
      s.alerts
    )) {
      if (await raiseAlert(db, e, d.kind, d.dedupeKey, d.vars, s)) created++;
    }
  }
  return created;
}

async function sendCloudApi(
  phone: string,
  message: string
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE ?? "gym_alert",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: message.replace(/\s*\n\s*/g, " ") },
              ],
            },
          ],
        },
      }),
    }
  );
  const body = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };
  return res.ok
    ? { ok: true, ref: body.messages?.[0]?.id ?? "" }
    : { ok: false, error: body.error?.message ?? `HTTP ${res.status}` };
}

/** Automatic delivery when the WhatsApp Business Cloud API is configured. */
export async function deliverPending(db: Db) {
  if (whatsappMode() !== "cloud_api") return { sent: 0, failed: 0 };
  const pending = await db
    .select()
    .from(memberAlerts)
    .where(eq(memberAlerts.status, "pending"))
    .orderBy(memberAlerts.id)
    .limit(50);
  let sent = 0;
  let failed = 0;
  for (const a of pending) {
    if (!a.phone) continue;
    const r = await sendCloudApi(a.phone, a.message).catch((e: unknown) => ({
      ok: false as const,
      error: String(e),
    }));
    if (r.ok) {
      sent++;
      await db
        .update(memberAlerts)
        .set({ status: "sent", sentAt: new Date(), error: null })
        .where(eq(memberAlerts.id, a.id));
    } else {
      failed++;
      await db
        .update(memberAlerts)
        .set({ status: "failed", error: r.error.slice(0, 300) })
        .where(eq(memberAlerts.id, a.id));
    }
  }
  return { sent, failed };
}

/**
 * Once per India day: re-apply access, queue the day's alerts and deliver them. Triggered by the
 * machine's first poll each day, so it runs without a scheduler; the config row is the lock.
 */
export async function runDailyJobs(db: Db, force = false) {
  const today = todayIST();
  // "{}" so defaults keep coming from the code until the owner saves settings.
  await db
    .insert(biometricConfig)
    .values({ id: 1, value: "{}" })
    .onConflictDoNothing();
  const claim = await db.execute(
    force
      ? sql`update gym_biometric_config set "lastDailyRun" = ${today} where id = 1`
      : sql`update gym_biometric_config set "lastDailyRun" = ${today} where id = 1 and ("lastDailyRun" is null or "lastDailyRun" <> ${today})`
  );
  if (!force && !affectedRows(claim))
    return { ran: false as const, today };
  const sync = await reconcileDevices(db, { reason: `daily ${today}` });
  const alerts = await runAlerts(db, today);
  const delivery = await deliverPending(db);
  await db.execute(
    sql`delete from gym_device_log where at < now() - interval '3 days'`
  );
  await db.execute(
    sql`delete from gym_device_commands where status in ('done', 'cancelled') and "createdAt" < now() - interval '30 days'`
  );
  return { ran: true as const, today, sync, alerts, delivery };
}

export async function recentCommandsFor(db: Db, memberId: number) {
  return db
    .select()
    .from(deviceCommands)
    .where(eq(deviceCommands.memberId, memberId))
    .orderBy(desc(deviceCommands.id))
    .limit(20);
}
