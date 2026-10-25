// End-to-end over the real /iclock endpoints and MySQL: the test plays the eSSL fingerprint
// machine (handshake, uploads, command polling, results) against the gym software.
// Runs only with BIOMETRIC_TEST_DATABASE_URL pointing at a database whose name ends in "_test";
// all tables in it are dropped first.
//   BIOMETRIC_TEST_DATABASE_URL=mysql://root@127.0.0.1:3407/fitcrush_test pnpm test

import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.BIOMETRIC_TEST_DATABASE_URL;
const safe =
  !!url &&
  /_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search ? "?" : ""));

describe.skipIf(!safe)("fingerprint machine over ADMS (MySQL)", () => {
  const SN = "ESSLX990TEST1";
  let base = "";
  let close: () => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let engine: typeof import("./engine");
  let schema: typeof import("../../drizzle/schema");
  let rules: typeof import("./rules");
  let memberId = 0;

  async function machine(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string>,
    body?: string
  ) {
    const qs = new URLSearchParams({ SN, ...query }).toString();
    const res = await fetch(`${base}/iclock/${path}?${qs}`, {
      method,
      ...(body !== undefined
        ? { body, headers: { "content-type": "text/plain" } }
        : {}),
    });
    return { status: res.status, text: await res.text() };
  }
  async function poll() {
    const r = await machine("GET", "getrequest", {});
    return r.text === "OK"
      ? []
      : r.text.split("\n").map(l => {
          const [, id, ...cmd] = l.split(":");
          return { id: Number(id), cmd: cmd.join(":") };
        });
  }
  async function ack(cmds: { id: number }[]) {
    if (cmds.length)
      await machine(
        "POST",
        "devicecmd",
        {},
        cmds.map(c => `ID=${c.id}&Return=0&CMD=DATA`).join("\n")
      );
  }
  const now = (offsetMin = 0) =>
    rules.dateToDeviceTime(new Date(Date.now() + offsetMin * 60_000));

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { drizzle } = await import("drizzle-orm/mysql2");
    const { migrate } = await import("drizzle-orm/mysql2/migrator");
    const { sql } = await import("drizzle-orm");
    const raw = drizzle(url!);
    const tables = (
      await raw.execute(
        sql`select table_name as t from information_schema.tables where table_schema = database()`
      )
    )[0] as unknown as { t: string }[];
    await raw.execute(sql`set foreign_key_checks = 0`);
    for (const { t } of tables)
      await raw.execute(sql.raw(`drop table \`${t}\``));
    await migrate(raw, { migrationsFolder: "drizzle" });
    engine = await import("./engine");
    schema = await import("../../drizzle/schema");
    rules = await import("./rules");
    db = await engine.requireDb();
    const { registerIclockRoutes } = await import("./iclock");
    const app = express();
    registerIclockRoutes(app);
    const server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();

    const today = rules.todayIST();
    const [m] = await db
      .insert(schema.members)
      .values({
        memberCode: "SW-TEST0001",
        name: "Ravi Kumar",
        phone: "9876543210",
        joiningDate: today,
      });
    memberId = Number(m.insertId);
    const [p] = await db
      .insert(schema.plans)
      .values({ name: "Monthly", durationDays: 30, price: 1500 });
    const [ms] = await db
      .insert(schema.memberships)
      .values({
        memberId,
        planId: Number(p.insertId),
        startDate: rules.addDays(today, -5),
        endDate: rules.addDays(today, 24),
        planName: "Monthly",
        planPrice: 1500,
        createdBy: 1,
      });
    await db
      .insert(schema.payments)
      .values({
        receiptNumber: "FC-T-1",
        memberId,
        membershipId: Number(ms.insertId),
        amount: 1500,
        mode: "upi",
        recordedBy: 1,
      });
  });
  afterAll(() => close());

  it("registers an unknown machine as pending and refuses its data", async () => {
    const hs = await machine("GET", "cdata", {
      options: "all",
      pushver: "2.4.1",
    });
    expect(hs.text).toContain(`GET OPTION FROM: ${SN}`);
    expect(hs.text).toContain("TimeZone=330");
    expect(
      (
        await machine(
          "POST",
          "cdata",
          { table: "ATTLOG", Stamp: "1" },
          `1001\t${now()}\t0\t1\t0\t0\t0`
        )
      ).status
    ).toBe(403);
  });

  it("after approval, linking a member sends them to the machine", async () => {
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.devices)
      .set({ status: "active" })
      .where(eq(schema.devices.sn, SN));
    await engine.linkMember(db, memberId, 1001, 1);
    const cmds = await poll();
    expect(
      cmds.some(c =>
        c.cmd.startsWith("DATA UPDATE USERINFO PIN=1001\tName=Ravi Kumar\t")
      )
    ).toBe(true);
    await ack(cmds);
  });

  it("mirrors users and backs up fingerprints the machine uploads", async () => {
    const body = [
      "USER PIN=1001\tName=Ravi Kumar\tPri=0\tPasswd=4321\tCard=9988776\tGrp=1\tTZ=0000000000000000\tVerify=-1",
      "USER PIN=1\tName=Owner\tPri=14\tPasswd=1111\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=0",
      "FP PIN=1001\tFID=6\tSize=4\tValid=1\tTMP=QUJD",
    ].join("\n");
    expect(
      (await machine("POST", "cdata", { table: "OPERLOG", Stamp: "7" }, body))
        .text
    ).toBe("OK: 3");
    const [fp] = await db.select().from(schema.fingerprintTemplates);
    expect(fp).toMatchObject({ pin: "1001", fid: 6, template: "QUJD" });
  });

  it("an allowed punch becomes the normal check-in; with check-out on, a later punch checks out", async () => {
    const s = await engine.getBiometricSettings(db);
    await engine.saveBiometricSettings(db, {
      ...s,
      machine: { ...s.machine, checkoutAfterMinutes: 30 },
    });
    await machine(
      "POST",
      "cdata",
      { table: "ATTLOG", Stamp: "2" },
      `1001\t${now(-60)}\t0\t1\t0\t0\t0\n4242\t${now(-60)}\t0\t1\t0\t0\t0`
    );
    const visits = await db.select().from(schema.attendance);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      memberId,
      method: "biometric",
      staffId: 0,
      checkedOutAt: null,
    });
    await machine(
      "POST",
      "cdata",
      { table: "ATTLOG", Stamp: "3" },
      `1001\t${now(-10)}\t0\t1\t0\t0\t0`
    );
    const [after] = await db.select().from(schema.attendance);
    expect(after.checkedOutAt).not.toBeNull();
    const punches = await db.select().from(schema.biometricPunches);
    expect(
      punches.find((p: { pin: string }) => p.pin === "4242")
    ).toMatchObject({ memberId: null, reason: "unknown_user" });
  });

  it("enforced: an expired member's fingerprints, card and password come off; a blocked punch alerts", async () => {
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.memberships)
      .set({ endDate: rules.addDays(rules.todayIST(), -1) })
      .where(eq(schema.memberships.memberId, memberId));
    const s = await engine.getBiometricSettings(db);
    await engine.saveBiometricSettings(db, {
      ...s,
      machine: { ...s.machine, enforce: true },
    });
    await engine.reconcileDevices(db, { reason: "test" });
    const cmds = await poll();
    expect(cmds.map(c => c.cmd)).toEqual([
      "DATA UPDATE USERINFO PIN=1001\tName=Ravi Kumar\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1",
      "DATA DELETE FINGERTMP PIN=1001",
    ]);
    await ack(cmds);
    // A card/keypad entry still reaches the machine's log: it is refused and alerts the member.
    await machine(
      "POST",
      "cdata",
      { table: "ATTLOG", Stamp: "4" },
      `1001\t${now(1)}\t0\t2\t0\t0\t0`
    );
    const alerts = await db
      .select()
      .from(schema.memberAlerts)
      .where(eq(schema.memberAlerts.kind, "blocked_attempt"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain("Hi Ravi");
  });

  it("renewal restores the card, password and backed-up fingerprint", async () => {
    const [plan] = await db.select().from(schema.plans);
    await db
      .insert(schema.memberships)
      .values({
        memberId,
        planId: plan.id,
        startDate: rules.todayIST(),
        endDate: rules.addDays(rules.todayIST(), 29),
        planName: "Monthly",
        planPrice: 1500,
        createdBy: 1,
      });
    await engine.reconcileDevices(db, { reason: "test" });
    const cmds = await poll();
    expect(cmds.map(c => c.cmd)).toEqual([
      "DATA UPDATE USERINFO PIN=1001\tName=Ravi Kumar\tPri=0\tPasswd=4321\tCard=9988776\tGrp=1\tTZ=0000000000000000\tVerify=-1",
      "DATA UPDATE FINGERTMP PIN=1001\tFID=6\tSize=4\tValid=1\tTMP=QUJD",
    ]);
    await ack(cmds);
  });

  it("never blocks a machine administrator", async () => {
    const today = rules.todayIST();
    const [m] = await db
      .insert(schema.members)
      .values({
        memberCode: "SW-OWNER01",
        name: "Owner",
        phone: "9000000001",
        joiningDate: today,
      });
    await engine.linkMember(db, Number(m.insertId), 1, 1);
    const cmds = await poll();
    expect(cmds.map(c => c.cmd)).toEqual([
      "DATA UPDATE USERINFO PIN=1\tName=Owner\tPri=14\tPasswd=1111\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=0",
    ]);
    await ack(cmds);
  });

  it("creates welcome and receipt alerts for new plans and payments", async () => {
    await engine.runAlerts(db);
    const kinds = (await db.select().from(schema.memberAlerts)).map(
      (a: { kind: string }) => a.kind
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        "welcome",
        "renewed",
        "receipt",
        "blocked_attempt",
      ])
    );
  });

  it("without a fingerprint backup, asks for one first and holds the block for 90 seconds", async () => {
    const { eq } = await import("drizzle-orm");
    const today = rules.todayIST();
    const [m] = await db
      .insert(schema.members)
      .values({
        memberCode: "SW-TEST0002",
        name: "Sneha Reddy",
        phone: "9876500000",
        joiningDate: today,
      });
    const id = Number(m.insertId);
    const [plan] = await db.select().from(schema.plans);
    await db
      .insert(schema.memberships)
      .values({
        memberId: id,
        planId: plan.id,
        startDate: rules.addDays(today, -40),
        endDate: rules.addDays(today, -10),
        planName: "Monthly",
        planPrice: 1500,
        createdBy: 1,
      });
    await engine.linkMember(db, id, 1002, 1);
    const first = await poll();
    expect(first.map(c => c.cmd)).toEqual(["DATA QUERY FINGERTMP PIN=1002"]);
    await ack(first);
    expect(await poll()).toEqual([]);
    await db
      .update(schema.deviceCommands)
      .set({ notBefore: new Date(Date.now() - 1000) })
      .where(eq(schema.deviceCommands.memberId, id));
    const block = await poll();
    expect(block.map(c => c.cmd)).toEqual([
      "DATA UPDATE USERINFO PIN=1002\tName=Sneha Reddy\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1",
      "DATA DELETE FINGERTMP PIN=1002",
    ]);
    await ack(block);
  });

  it("re-sends commands the machine never answered", async () => {
    const { eq } = await import("drizzle-orm");
    await engine.queueDeviceCommand(db, SN, "info");
    const first = await poll();
    expect(first[0]?.cmd).toBe("INFO");
    await db
      .update(schema.deviceCommands)
      .set({ sentAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.deviceCommands.id, first[0]!.id));
    const again = await poll();
    expect(again[0]?.id).toBe(first[0]!.id);
    await ack(again);
  });
});
