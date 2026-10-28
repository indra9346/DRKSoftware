// Email + password sign-in for self-hosted installs (AUTH_MODE=local), used instead of
// Manus OAuth. It only proves who is signing in: roles still come from the existing
// users / staff-invite rules in db.upsertUser, so "Add staff" works the same way.
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import {
  gymSettings,
  loginCredentials,
  staffInvites,
  users,
} from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { localAuthEnabled } from "./env";
import { sdk } from "./sdk";

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
// scrypt cost: about 50 ms per check on a small server.
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };
const LOCK_AFTER_FAILURES = 8;
const LOCK_MS = 15 * 60_000;
const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX_FAILURES = 30;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use at most ${MAX_PASSWORD_LENGTH} characters for the password.`;
  return null;
}

function derive(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keyLength: number
) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      { N, r, p, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const key = await derive(password, salt, N, r, p, keyLength);
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64"),
    Number(n),
    Number(r),
    Number(p),
    expected.length
  );
  return timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;

async function requireDb() {
  const database = await db.getDb();
  if (!database)
    throw new Error("Database is not available. Check DATABASE_URL.");
  return database;
}

export async function findCredential(email: string) {
  const database = await requireDb();
  return (
    await database
      .select()
      .from(loginCredentials)
      .where(eq(loginCredentials.email, normalizeEmail(email)))
      .limit(1)
  )[0];
}

export async function findCredentialByOpenId(openId: string) {
  const database = await requireDb();
  return (
    await database
      .select()
      .from(loginCredentials)
      .where(eq(loginCredentials.openId, openId))
      .limit(1)
  )[0];
}

/** Whole seconds, so it compares exactly with a session's issued-at time. */
const wholeSecondNow = () => new Date(Math.floor(Date.now() / 1000) * 1000);

/**
 * Creates or replaces the password for an email. An account that already exists with that
 * email (for example one that signed in through Manus before the move) keeps its openId,
 * so its role and history stay. Changing a password ends that person's other sessions.
 */
export async function setPassword(
  email: string,
  password: string,
  createdBy: number | null = null
): Promise<{ openId: string; created: boolean }> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const database = await requireDb();
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const passwordChangedAt = wholeSecondNow();
  const existing = await findCredential(normalized);
  if (existing) {
    await database
      .update(loginCredentials)
      .set({
        passwordHash,
        passwordChangedAt,
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(loginCredentials.id, existing.id));
    return { openId: existing.openId, created: false };
  }
  const account = (
    await database
      .select({ openId: users.openId })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)
  )[0];
  const openId = account?.openId ?? `local_${randomUUID().replace(/-/g, "")}`;
  await database
    .insert(loginCredentials)
    .values({
      email: normalized,
      openId,
      passwordHash,
      passwordChangedAt,
      createdBy,
    });
  return { openId, created: true };
}

/** Creates the users row for a login (or refreshes it) without wiping the stored name. */
export async function syncAccount(
  openId: string,
  email: string,
  name?: string | null
) {
  const database = await requireDb();
  const existing = await db.getUserByOpenId(openId);
  const invite = existing
    ? undefined
    : (
        await database
          .select({ name: staffInvites.name })
          .from(staffInvites)
          .where(eq(staffInvites.email, normalizeEmail(email)))
          .limit(1)
      )[0];
  await db.upsertUser({
    openId,
    email,
    name: name || existing?.name || invite?.name || null,
    loginMethod: "password",
    lastSignedIn: new Date(),
  });
  return db.getUserByOpenId(openId);
}

/** Makes this login the gym's owner (full admin, cannot be demoted from the app). */
export async function makeOwner(
  openId: string,
  email: string,
  name?: string | null
) {
  const database = await requireDb();
  const settings = await db.getGymSettings();
  if (!settings) throw new Error("Gym settings row could not be created.");
  await database
    .update(gymSettings)
    .set({ ownerOpenId: openId })
    .where(eq(gymSettings.id, settings.id));
  return syncAccount(openId, email, name);
}

const ipFailures = new Map<string, { count: number; resetAt: number }>();

function ipBlocked(ip: string) {
  const entry = ipFailures.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= IP_MAX_FAILURES;
}

function noteIpFailure(ip: string) {
  const now = Date.now();
  const entry = ipFailures.get(ip);
  if (!entry || entry.resetAt < now)
    ipFailures.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
  else entry.count += 1;
  if (ipFailures.size > 10_000) {
    for (const [key, value] of Array.from(ipFailures))
      if (value.resetAt < now) ipFailures.delete(key);
  }
}

type SignInResult =
  | { ok: true; openId: string; name: string }
  | { ok: false; status: 400 | 401 | 403 | 429; error: string };

const WRONG = "Email or password is not correct.";

export async function signInWithPassword(
  emailInput: unknown,
  passwordInput: unknown,
  ip = "unknown"
): Promise<SignInResult> {
  if (
    typeof emailInput !== "string" ||
    typeof passwordInput !== "string" ||
    !emailInput.trim() ||
    !passwordInput
  )
    return { ok: false, status: 400, error: "Enter your email and password." };
  if (passwordInput.length > MAX_PASSWORD_LENGTH)
    return { ok: false, status: 401, error: WRONG };
  if (ipBlocked(ip))
    return {
      ok: false,
      status: 429,
      error:
        "Too many wrong attempts from this network. Try again in 15 minutes.",
    };
  const database = await requireDb();
  const email = normalizeEmail(emailInput);
  const credential = await findCredential(email);
  if (!credential) {
    dummyHash ??= hashPassword(randomUUID());
    await verifyPassword(passwordInput, await dummyHash);
    noteIpFailure(ip);
    return { ok: false, status: 401, error: WRONG };
  }
  const now = Date.now();
  if (credential.lockedUntil && credential.lockedUntil.getTime() > now) {
    const minutes = Math.ceil(
      (credential.lockedUntil.getTime() - now) / 60_000
    );
    return {
      ok: false,
      status: 429,
      error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the owner to reset it.`,
    };
  }
  if (!(await verifyPassword(passwordInput, credential.passwordHash))) {
    noteIpFailure(ip);
    const failures = credential.failedAttempts + 1;
    const lock = failures >= LOCK_AFTER_FAILURES;
    await database
      .update(loginCredentials)
      .set({
        failedAttempts: lock ? 0 : failures,
        lockedUntil: lock ? new Date(now + LOCK_MS) : credential.lockedUntil,
      })
      .where(eq(loginCredentials.id, credential.id));
    return lock
      ? {
          ok: false,
          status: 429,
          error:
            "Too many wrong passwords. This login is paused for 15 minutes.",
        }
      : { ok: false, status: 401, error: WRONG };
  }
  if (credential.failedAttempts || credential.lockedUntil)
    await database
      .update(loginCredentials)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(loginCredentials.id, credential.id));
  const user = await syncAccount(credential.openId, credential.email);
  if (!user)
    return {
      ok: false,
      status: 403,
      error: "This account could not be loaded.",
    };
  return { ok: true, openId: credential.openId, name: user.name ?? "" };
}

export async function issueSessionCookie(
  req: Request,
  res: Response,
  openId: string,
  name: string
) {
  const token = await sdk.createSessionToken(openId, {
    name,
    expiresInMs: ONE_YEAR_MS,
  });
  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: ONE_YEAR_MS,
  });
}

export function registerLocalAuthRoutes(app: Express) {
  if (!localAuthEnabled()) return;
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    // JSON only: a plain cross-site form post cannot sign someone in to the attacker's account.
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Send the login as JSON." });
      return;
    }
    try {
      const result = await signInWithPassword(
        req.body?.email,
        req.body?.password,
        req.ip
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      await issueSessionCookie(req, res, result.openId, result.name);
      res.json({ success: true });
    } catch (error) {
      console.error(
        "[Login] Failed:",
        error instanceof Error ? error.message : error
      );
      res
        .status(500)
        .json({
          error: "Sign-in is unavailable. Check that the database is running.",
        });
    }
  });
}

/**
 * First start of a new install: FIRST_OWNER_EMAIL + FIRST_OWNER_PASSWORD create the owner's
 * login if it does not exist yet. It never overwrites an existing password, so the values
 * can be removed from the host's settings after the first sign-in.
 */
export async function ensureFirstOwner(env: NodeJS.ProcessEnv = process.env) {
  const email = env.FIRST_OWNER_EMAIL?.trim();
  const password = env.FIRST_OWNER_PASSWORD;
  if (!localAuthEnabled(env) || !email || !password) return;
  if (await findCredential(email)) {
    console.log(
      "[Setup] Owner login already exists; FIRST_OWNER_PASSWORD is ignored and can be removed."
    );
    return;
  }
  const settings = await db.getGymSettings();
  const { openId } = await setPassword(email, password);
  if (!settings?.ownerOpenId || settings.ownerOpenId === openId) {
    await makeOwner(openId, email, env.FIRST_OWNER_NAME?.trim() || null);
    console.log(`[Setup] Owner login created for ${normalizeEmail(email)}.`);
  } else {
    await syncAccount(openId, email);
    console.warn(
      `[Setup] A different owner is already set, so ${normalizeEmail(email)} was created without a role. ` +
        "Run `node dist/fitcrush.js password <email> --owner` to make it the owner."
    );
  }
}
