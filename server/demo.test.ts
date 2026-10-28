// Demo mode (used for the Vercel demo): with no DATABASE_URL it builds an in-memory
// PostgreSQL, fills the sample data and creates the demo logins shown on the sign-in page.
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_LOGINS } from "@shared/demo";

describe("demo mode on the in-memory database", () => {
  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.DEMO_MODE = "true";
    const { prepareDemo } = await import("./demo/seed");
    await prepareDemo();
    await prepareDemo(); // a second start changes nothing
  }, 60_000);

  it("signs in with every demo login, each with its role", async () => {
    const auth = await import("./_core/localAuth");
    const db = await import("./db");
    const roles: string[] = [];
    for (const login of DEMO_LOGINS) {
      const result = await auth.signInWithPassword(
        login.email,
        login.password,
        "127.0.0.1"
      );
      expect(result.ok).toBe(true);
      if (result.ok)
        roles.push((await db.getUserByOpenId(result.openId))!.role);
    }
    expect(roles).toEqual(["admin", "receptionist", "trainer", "member"]);
  });

  it("has the sample gym data, the machine and today's punches", async () => {
    const db = (await import("./db")).getDb;
    const schema = await import("../drizzle/schema");
    const database = (await db())!;
    expect((await database.select().from(schema.members)).length).toBe(15);
    expect((await database.select().from(schema.plans)).length).toBe(4);
    const [machine] = await database.select().from(schema.devices);
    expect(machine).toMatchObject({ status: "active", name: "Entrance" });
    const punches = await database.select().from(schema.biometricPunches);
    expect(punches.some(p => p.allowed === false)).toBe(true);
    expect(punches.some(p => p.allowed === true)).toBe(true);
    const settings = (await database.select().from(schema.gymSettings))[0];
    expect(settings.gymName).toBe("DRK Fitness Gym");
  });

  it("keeps the demo logins from being paused by wrong passwords", async () => {
    const auth = await import("./_core/localAuth");
    for (let i = 0; i < 10; i++)
      await auth.signInWithPassword(
        DEMO_LOGINS[0].email,
        "wrong",
        `10.0.0.${i}`
      );
    const result = await auth.signInWithPassword(
      DEMO_LOGINS[0].email,
      DEMO_LOGINS[0].password,
      "10.0.1.1"
    );
    expect(result.ok).toBe(true);
  });
});
