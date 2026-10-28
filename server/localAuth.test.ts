// Email + password sign-in (AUTH_MODE=local). Hashing runs always; the database part runs
// only with BIOMETRIC_TEST_DATABASE_URL set (it uses "<that name>_auth" so it never clashes
// with the machine test, and drops everything in that database first):
//   BIOMETRIC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5544/fitcrush_test pnpm test
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./_core/localAuth";

describe("password hashing", () => {
  it("accepts the right password and rejects others", async () => {
    const hash = await hashPassword("desk-pass-123");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("desk-pass-123", hash)).toBe(true);
    expect(await verifyPassword("desk-pass-124", hash)).toBe(false);
    expect(await verifyPassword("desk-pass-123", "not-a-hash")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("enforces a minimum length", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("long enough")).toBeNull();
  });
});

const base = process.env.BIOMETRIC_TEST_DATABASE_URL;
const url = base
  ? (() => {
      const u = new URL(base);
      u.pathname = `${u.pathname}_auth`;
      return u.toString();
    })()
  : "";
const safe = !!base && /_test$/.test(new URL(base).pathname);

describe.skipIf(!safe)("password sign-in against PostgreSQL", () => {
  let auth: typeof import("./_core/localAuth");
  let session: typeof import("./_core/localSession");
  let db: typeof import("./db");
  let schema: typeof import("../drizzle/schema");
  let sdk: (typeof import("./_core/sdk"))["sdk"];
  let eq: (typeof import("drizzle-orm"))["eq"];

  beforeAll(async () => {
    const { openClient, runMigrations } = await import("./_core/selfHost");
    const admin = await openClient(base!);
    const name = new URL(url).pathname.slice(1);
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
    await admin.end();
    await runMigrations(url);
    Object.assign(process.env, {
      DATABASE_URL: url,
      AUTH_MODE: "local",
      JWT_SECRET: "test-secret-that-is-long-enough-123456",
      FIRST_OWNER_EMAIL: "Owner@FitCrush.in",
      FIRST_OWNER_PASSWORD: "owner-pass-1",
    });
    auth = await import("./_core/localAuth");
    session = await import("./_core/localSession");
    db = await import("./db");
    schema = await import("../drizzle/schema");
    sdk = (await import("./_core/sdk")).sdk;
    eq = (await import("drizzle-orm")).eq;
  });
  afterAll(() => {
    for (const key of [
      "AUTH_MODE",
      "JWT_SECRET",
      "FIRST_OWNER_EMAIL",
      "FIRST_OWNER_PASSWORD",
    ])
      delete process.env[key];
  });

  it("creates the first owner from the start-up settings, once", async () => {
    await auth.ensureFirstOwner();
    await auth.ensureFirstOwner(); // second start: nothing changes
    const credential = await auth.findCredential("owner@fitcrush.in");
    expect(credential?.email).toBe("owner@fitcrush.in");
    const settings = await db.getGymSettings();
    expect(settings?.ownerOpenId).toBe(credential?.openId);
    const user = await db.getUserByOpenId(credential!.openId);
    expect(user?.role).toBe("admin");
  });

  it("signs in with the right password only", async () => {
    expect(
      await auth.signInWithPassword(
        "owner@fitcrush.in",
        "wrong-pass",
        "1.1.1.1"
      )
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      await auth.signInWithPassword(
        "nobody@fitcrush.in",
        "owner-pass-1",
        "1.1.1.1"
      )
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      await auth.signInWithPassword(
        " OWNER@fitcrush.in ",
        "owner-pass-1",
        "1.1.1.1"
      )
    ).toMatchObject({ ok: true });
  });

  it("keeps the stored name and email on every page load (per-request refresh)", async () => {
    const credential = await auth.findCredential("owner@fitcrush.in");
    const database = (await db.getDb())!;
    await database
      .update(schema.users)
      .set({ name: "Gym Owner" })
      .where(eq(schema.users.openId, credential!.openId));
    await db.upsertUser({
      openId: credential!.openId,
      lastSignedIn: new Date(),
    });
    const user = await db.getUserByOpenId(credential!.openId);
    expect(user).toMatchObject({
      name: "Gym Owner",
      email: "owner@fitcrush.in",
      loginMethod: "password",
    });
  });

  it("pauses a login after 8 wrong passwords, and a reset unpauses it", async () => {
    for (let i = 0; i < 7; i++)
      expect(
        (await auth.signInWithPassword("owner@fitcrush.in", "bad", "2.2.2.2"))
          .ok
      ).toBe(false);
    expect(
      await auth.signInWithPassword("owner@fitcrush.in", "bad", "2.2.2.2")
    ).toMatchObject({ status: 429 });
    expect(
      await auth.signInWithPassword(
        "owner@fitcrush.in",
        "owner-pass-1",
        "2.2.2.2"
      )
    ).toMatchObject({ status: 429 });
    await auth.setPassword("owner@fitcrush.in", "owner-pass-2");
    expect(
      await auth.signInWithPassword(
        "owner@fitcrush.in",
        "owner-pass-2",
        "2.2.2.2"
      )
    ).toMatchObject({ ok: true });
  });

  it("ends older sessions when the password changes", async () => {
    const credential = (await auth.findCredential("owner@fitcrush.in"))!;
    const oldToken = await sdk.createSessionToken(credential.openId, {
      name: "",
    });
    const old = await sdk.verifySession(oldToken);
    expect(
      await session.credentialSessionValid(credential.openId, old!.issuedAt)
    ).toBe(true);
    await new Promise(r => setTimeout(r, 1100)); // the change lands in a later second
    await auth.setPassword("owner@fitcrush.in", "owner-pass-3");
    expect(
      await session.credentialSessionValid(credential.openId, old!.issuedAt)
    ).toBe(false);
    const fresh = await sdk.verifySession(
      await sdk.createSessionToken(credential.openId, { name: "" })
    );
    expect(
      await session.credentialSessionValid(credential.openId, fresh!.issuedAt)
    ).toBe(true);
  });

  it("gives an invited receptionist their role and name on first sign-in", async () => {
    const database = (await db.getDb())!;
    await database
      .insert(schema.staffInvites)
      .values({
        email: "desk@fitcrush.in",
        name: "Front Desk",
        role: "receptionist",
        createdBy: 1,
      });
    await auth.setPassword("desk@fitcrush.in", "desk-pass-1");
    const result = await auth.signInWithPassword(
      "desk@fitcrush.in",
      "desk-pass-1",
      "3.3.3.3"
    );
    expect(result.ok).toBe(true);
    const credential = (await auth.findCredential("desk@fitcrush.in"))!;
    expect(await db.getUserByOpenId(credential.openId)).toMatchObject({
      role: "receptionist",
      name: "Front Desk",
      active: true,
    });
  });

  it("recognises a duplicate check-in as a unique-key clash", async () => {
    const database = (await db.getDb())!;
    const row = {
      memberId: 1,
      checkInDate: "2026-10-28",
      method: "manual" as const,
      staffId: 1,
    };
    await database.insert(schema.attendance).values(row);
    const error = await database
      .insert(schema.attendance)
      .values(row)
      .then(
        () => null,
        e => e
      );
    expect(db.isUniqueViolation(error)).toBe(true);
    expect(db.isUniqueViolation(new Error("other"))).toBe(false);
  });

  it("locks every table away from the Supabase Data API (row level security on)", async () => {
    const { openClient, tablesWithoutRls } = await import("./_core/selfHost");
    const client = await openClient(url);
    expect(await tablesWithoutRls(client)).toEqual([]);
    const { rows } = await client.query(
      `select count(*)::int as n from pg_trigger where tgname = 'gym_updated_at'`
    );
    expect(rows[0].n).toBe(12);
    await client.end();
  });
});
