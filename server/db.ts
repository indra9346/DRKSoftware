import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "fs";
import pg from "pg";
import {
  attendance,
  auditLogs,
  expenses,
  followUps,
  gymSettings,
  GymMember,
  members,
  membershipFreezes,
  memberships,
  payments,
  plans,
  progressEntries,
  receiptCounters,
  staffInvites,
  User,
  users,
  workouts,
  InsertUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * TLS for the database connection. Hosted Postgres (Supabase) is encrypted by default.
 * DATABASE_SSL_CA (a file path or the PEM text of Supabase's "SSL certificate") also
 * verifies the server; DATABASE_SSL=false turns TLS off (only for a database on this PC).
 */
function sslOption(host: string, env: NodeJS.ProcessEnv): pg.PoolConfig["ssl"] {
  const mode = (env.DATABASE_SSL ?? "").trim().toLowerCase();
  if (mode === "false" || mode === "off" || mode === "disable") return false;
  const ca = env.DATABASE_SSL_CA?.trim();
  if (ca)
    return {
      ca: ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8"),
      rejectUnauthorized: true,
    };
  if (!mode && LOCAL_HOSTS.has(host)) return false;
  return { rejectUnauthorized: false };
}

export function connectionOptions(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): pg.PoolConfig {
  const parsed = new URL(url);
  // TLS comes from sslOption, not ?sslmode= in the address: newer pg versions treat
  // "require" as full verification, which fails against Supabase's own certificate authority.
  for (const key of [
    "sslmode",
    "ssl",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "uselibpqcompat",
  ])
    parsed.searchParams.delete(key);
  return {
    connectionString: parsed.toString(),
    ssl: sslOption(parsed.hostname, env),
    application_name: "fitcrush",
  };
}

/**
 * The app's connection pool. Sessions run in UTC so any SQL that turns a time into text or
 * a date behaves the same on every server; app dates use India time explicitly.
 * Supabase: use the Session pooler address (port 5432), which works over IPv4.
 */
export function createPool(url: string, env: NodeJS.ProcessEnv = process.env) {
  const pool = new pg.Pool({
    ...connectionOptions(url, env),
    max: Number(env.DATABASE_POOL_SIZE) || 5,
    idleTimeoutMillis: 30_000,
  });
  pool.on("connect", client => {
    client.query("SET TIME ZONE 'UTC'").catch(error => {
      console.error("[Database] Could not set UTC session:", error.message);
    });
  });
  // A dropped idle connection (pooler restart, network blip) must not crash the server.
  pool.on("error", error =>
    console.error("[Database] Idle connection error:", error.message)
  );
  return pool;
}

/** A unique-key clash (Postgres 23505). Drizzle wraps the driver error in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    if (
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: unknown }).code === "23505"
    )
      return true;
    e =
      typeof e === "object" && "cause" in e
        ? (e as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

let _db: ReturnType<typeof drizzle> | null = null;
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(createPool(process.env.DATABASE_URL));
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export function todayIST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
export function monthStartIST() {
  return `${todayIST().slice(0, 7)}-01`;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const currentSettings = await getGymSettings();
  if (!currentSettings) throw new Error("Gym settings are not available");
  let ownerOpenId: string | null = ENV.ownerOpenId || null;
  if (ownerOpenId && ownerOpenId !== currentSettings.ownerOpenId) {
    await db
      .update(gymSettings)
      .set({ ownerOpenId })
      .where(eq(gymSettings.id, currentSettings.id));
  } else if (!ownerOpenId && !currentSettings.ownerOpenId) {
    await db
      .update(gymSettings)
      .set({ ownerOpenId: user.openId })
      .where(
        and(
          eq(gymSettings.id, currentSettings.id),
          sql`${gymSettings.ownerOpenId} IS NULL`
        )
      );
  }
  if (!ownerOpenId)
    ownerOpenId = (await getGymSettings())?.ownerOpenId ?? user.openId;
  const normalizedEmail = user.email?.trim().toLowerCase() ?? null;
  const existing = (
    await db.select().from(users).where(eq(users.openId, user.openId)).limit(1)
  )[0];
  const invitation = normalizedEmail
    ? (
        await db
          .select()
          .from(staffInvites)
          .where(eq(staffInvites.email, normalizedEmail))
          .limit(1)
      )[0]
    : undefined;
  const values: InsertUser = {
    ...user,
    email: normalizedEmail,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  // Only fields the caller supplied are updated: the per-request "last signed in" refresh
  // passes just openId and must not blank the stored name, email or login method.
  const updateSet: Record<string, unknown> = {
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  if (user.name !== undefined) updateSet.name = user.name ?? null;
  if (user.email !== undefined) updateSet.email = normalizedEmail;
  if (user.loginMethod !== undefined)
    updateSet.loginMethod = user.loginMethod ?? null;
  if (user.openId === ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  } else if (!existing && invitation?.active) {
    values.role = invitation.role;
    values.linkedMemberId = invitation.linkedMemberId;
    values.active = true;
    updateSet.role = invitation.role;
    updateSet.linkedMemberId = invitation.linkedMemberId;
    updateSet.active = true;
  }
  if (user.role !== undefined) updateSet.role = user.role;
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.openId, set: updateSet });
  if (invitation?.active)
    await db
      .update(staffInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(staffInvites.id, invitation.id));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (
    await db.select().from(users).where(eq(users.openId, openId)).limit(1)
  )[0];
}
export async function audit(
  actorId: number,
  action: string,
  entityType: string,
  entityId: number | null,
  reason?: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db
    .insert(auditLogs)
    .values({ actorId, action, entityType, entityId, reason: reason ?? null });
}

export async function getGymSettings() {
  const db = await getDb();
  if (!db) return null;
  const existing = (await db.select().from(gymSettings).limit(1))[0];
  if (existing) return existing;
  // Another request may create the singleton at the same moment.
  await db.insert(gymSettings).values({ id: 1 }).onConflictDoNothing();
  return (await db.select().from(gymSettings).limit(1))[0] ?? null;
}

export async function getMemberByCodeOrId(value: string) {
  const db = await getDb();
  if (!db) return undefined;
  const code = (
    await db
      .select()
      .from(members)
      // Postgres compares text case-sensitively; staff may type "sw-ab12cd34".
      .where(sql`upper(${members.memberCode}) = ${value.toUpperCase()}`)
      .limit(1)
  )[0];
  if (code) return code;
  if (/^\d+$/.test(value)) {
    const byId = (
      await db
        .select()
        .from(members)
        .where(eq(members.id, Number(value)))
        .limit(1)
    )[0];
    if (byId) return byId;
  }
  const phone = (
    await db.select().from(members).where(eq(members.phone, value)).limit(1)
  )[0];
  if (phone) return phone;
  const byName = await db
    .select()
    .from(members)
    .where(sql`LOWER(${members.name}) LIKE ${`%${value.toLowerCase()}%`}`)
    .limit(2);
  if (byName.length > 1)
    throw new Error(
      "Several members match that name. Use the member ID or full phone number."
    );
  return byName[0];
}

type GymDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type GymTransaction = Parameters<Parameters<GymDatabase["transaction"]>[0]>[0];

export async function recordPaymentInTransaction(
  tx: GymTransaction,
  input: {
    memberId: number;
    membershipId?: number | null;
    amount: number;
    mode: "cash" | "upi" | "bank";
    notes?: string | null;
    recordedBy: number;
  }
) {
  const now = new Date();
  const period = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .replace("-", "");
  const [counter] = await tx
    .insert(receiptCounters)
    .values({ period, lastNumber: 1 })
    .onConflictDoUpdate({
      target: receiptCounters.period,
      set: { lastNumber: sql`${receiptCounters.lastNumber} + 1` },
    })
    .returning();
  const receiptNumber = `SW-${period}-${String(counter.lastNumber).padStart(6, "0")}`;
  const [inserted] = await tx
    .insert(payments)
    .values({
      receiptNumber,
      memberId: input.memberId,
      membershipId: input.membershipId ?? null,
      amount: input.amount,
      mode: input.mode,
      notes: input.notes ?? null,
      recordedBy: input.recordedBy,
    })
    .returning({ id: payments.id });
  const id = inserted.id;
  await tx.insert(auditLogs).values({
    actorId: input.recordedBy,
    action: "payment.recorded",
    entityType: "payment",
    entityId: id,
    reason: receiptNumber,
  });
  return { id, receiptNumber, recordedAt: now };
}

export async function listPayments(
  memberId?: number,
  from?: string,
  to?: string,
  limit = 1000
) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (memberId) filters.push(eq(payments.memberId, memberId));
  if (from)
    filters.push(gte(payments.recordedAt, new Date(`${from}T00:00:00+05:30`)));
  if (to)
    filters.push(lte(payments.recordedAt, new Date(`${to}T23:59:59+05:30`)));
  const base = db
    .select({
      payment: payments,
      memberName: members.name,
      memberCode: members.memberCode,
    })
    .from(payments)
    .innerJoin(members, eq(payments.memberId, members.id));
  const query = filters.length ? base.where(and(...filters)) : base;
  return query.orderBy(desc(payments.recordedAt)).limit(limit);
}

export async function listAttendance(from?: string, to?: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  const filters = [];
  if (from) filters.push(gte(attendance.checkInDate, from));
  if (to) filters.push(lte(attendance.checkInDate, to));
  const base = db
    .select({
      attendance,
      memberName: members.name,
      memberCode: members.memberCode,
      phone: members.phone,
    })
    .from(attendance)
    .innerJoin(members, eq(attendance.memberId, members.id));
  const query = filters.length ? base.where(and(...filters)) : base;
  return query.orderBy(desc(attendance.checkedInAt)).limit(limit);
}

export async function listMembersByIds(ids: number[]) {
  const db = await getDb();
  if (!db || !ids.length) return [];
  return db.select().from(members).where(inArray(members.id, ids));
}

export const gymTables = {
  attendance,
  auditLogs,
  expenses,
  followUps,
  gymSettings,
  members,
  membershipFreezes,
  memberships,
  payments,
  plans,
  progressEntries,
  receiptCounters,
  staffInvites,
  users,
  workouts,
};
export type GymUser = User;
export type { GymMember };
