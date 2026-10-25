import { describe, expect, it } from "vitest";
import {
  cmdUpdateUser,
  handshakeResponse,
  parseAttLog,
  parseCommandResults,
  parseOperLog,
} from "./adms";
import {
  accessState,
  dailyAlerts,
  dateToDeviceTime,
  DEFAULT_BIOMETRIC_SETTINGS,
  desiredOnDevice,
  deviceTimeToDate,
  renderTemplate,
  todayIST,
  waNumber,
  type MemberFacts,
  type TermFacts,
} from "./rules";

const member: MemberFacts = {
  id: 1,
  name: "Ravi Kumar",
  status: "active",
  override: null,
};
const term = (o: Partial<TermFacts> = {}): TermFacts => ({
  id: 1,
  planName: "Monthly",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  status: "active",
  fee: 1500,
  paid: 1500,
  ...o,
});
const machine = DEFAULT_BIOMETRIC_SETTINGS.machine;

describe("access rule matches the desk check-in", () => {
  it("active membership covering today lets the member in", () => {
    const s = accessState(member, [term()], "2026-10-11");
    expect(s).toMatchObject({
      allowed: true,
      reason: "active",
      daysLeft: 20,
      headline: "20 days left",
    });
  });
  it("warns in the expiry window and on the last day", () => {
    expect(accessState(member, [term()], "2026-10-28").reason).toBe("expiring");
    expect(accessState(member, [term()], "2026-10-31")).toMatchObject({
      allowed: true,
      reason: "ends_today",
    });
  });
  it("blocks the day after the end date: renew & pay", () => {
    expect(accessState(member, [term()], "2026-11-01")).toMatchObject({
      allowed: false,
      reason: "expired",
      expiredOn: "2026-10-31",
      headline: "Access blocked - renew & pay",
    });
  });
  it("frozen or inactive profiles are blocked, like the desk", () => {
    expect(
      accessState({ ...member, status: "frozen" }, [term()], "2026-10-11")
        .reason
    ).toBe("frozen");
    expect(
      accessState({ ...member, status: "inactive" }, [term()], "2026-10-11")
        .reason
    ).toBe("inactive");
  });
  it("only ACTIVE memberships count; cancelled and frozen terms do not", () => {
    expect(
      accessState(member, [term({ status: "cancelled" })], "2026-10-11").reason
    ).toBe("no_membership");
    expect(
      accessState(member, [term({ status: "frozen" })], "2026-10-11").allowed
    ).toBe(false);
  });
  it("stacked renewals count as one period", () => {
    const s = accessState(
      member,
      [term(), term({ id: 2, startDate: "2026-11-01", endDate: "2026-11-30" })],
      "2026-10-30"
    );
    expect(s).toMatchObject({
      reason: "active",
      validUntil: "2026-11-30",
      daysLeft: 31,
    });
  });
  it("a future plan does not open the door yet", () => {
    expect(
      accessState(
        member,
        [term({ startDate: "2026-11-01", endDate: "2026-11-30" })],
        "2026-10-30"
      ).reason
    ).toBe("not_started");
  });
  it("owner overrides win", () => {
    expect(
      accessState({ ...member, override: "block" }, [term()], "2026-10-11")
        .allowed
    ).toBe(false);
    expect(
      accessState(
        { ...member, override: "allow", status: "frozen" },
        [],
        "2026-10-11"
      ).allowed
    ).toBe(true);
  });
  it("tracks dues without blocking", () => {
    const s = accessState(member, [term({ paid: 500 })], "2026-10-11");
    expect(s).toMatchObject({
      allowed: true,
      balanceDue: 1000,
      duesSince: "2026-10-01",
    });
  });
});

describe("what the machine should hold", () => {
  const expired = accessState(member, [term()], "2026-11-01");
  it("monitor mode never blocks by membership", () => {
    expect(desiredOnDevice("Ravi", expired, machine).allowed).toBe(true);
  });
  it("monitor mode still honours the owner's Always block", () => {
    const s = accessState(
      { ...member, override: "block" },
      [term()],
      "2026-10-11"
    );
    expect(desiredOnDevice("Ravi", s, machine)).toEqual({
      present: true,
      allowed: false,
      blockMode: "fingers",
      message: null,
    });
  });
  it("enforced: fingers mode keeps the user, remove mode deletes, group mode keeps a message", () => {
    const on = { ...machine, enforce: true };
    expect(desiredOnDevice("Ravi", expired, on)).toMatchObject({
      present: true,
      allowed: false,
      blockMode: "fingers",
    });
    expect(
      desiredOnDevice("Ravi", expired, { ...on, blockMode: "remove" }).present
    ).toBe(false);
    expect(
      desiredOnDevice("Ravi", expired, { ...on, blockMode: "group" }).message
    ).toBe("Ravi: ACCESS BLOCKED. Please renew & pay");
  });
  it("shows days left on the machine when expiring", () => {
    expect(
      desiredOnDevice(
        "Ravi Kumar",
        accessState(member, [term()], "2026-10-28"),
        machine
      ).message
    ).toBe("Hi Ravi, 3 days left. Please renew");
  });
});

describe("alerts", () => {
  const a = DEFAULT_BIOMETRIC_SETTINGS.alerts;
  const due = (
    today: string,
    terms = [term()],
    lastVisit: string | null = today
  ) =>
    dailyAlerts(
      {
        state: accessState(member, terms, today),
        dob: "1995-11-03",
        lastVisit,
        currentStart: "2026-10-01",
      },
      today,
      a
    ).map(x => x.dedupeKey);
  it("reminds at 7, 3 and 1 days, then ends today, then blocked", () => {
    expect(due("2026-10-24")).toEqual(["expiry:2026-10-31:7"]);
    expect(due("2026-10-28")).toEqual(["expiry:2026-10-31:3"]);
    expect(due("2026-10-30")).toEqual(["expiry:2026-10-31:1"]);
    expect(due("2026-10-31")).toEqual(["ends:2026-10-31"]);
    expect(due("2026-11-01")).toEqual(["expired:2026-10-31"]);
  });
  it("never messages long-expired members on day one", () => {
    expect(due("2026-12-20")).toEqual([]);
  });
  it("win-back, dues, absence and birthday", () => {
    expect(due("2026-11-07")).toEqual(["winback:2026-10-31:7"]);
    expect(due("2026-10-04", [term({ paid: 500 })])).toEqual([
      "dues:2026-10-01:3",
    ]);
    expect(due("2026-10-15", [term()], "2026-10-08")).toEqual([
      "absent:2026-10-08",
    ]);
    expect(due("2026-11-03", [term({ endDate: "2026-12-31" })])).toEqual([
      "birthday:2026",
    ]);
  });
  it("renders templates and WhatsApp numbers", () => {
    expect(renderTemplate("Hi {name}, {x}see you", { name: "Ravi" })).toBe(
      "Hi Ravi, see you"
    );
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("12345")).toBeNull();
  });
});

describe("ADMS protocol", () => {
  it("handshake uses India time in minutes and both stamp spellings", () => {
    const h = handshakeResponse({
      sn: "X1",
      attStamp: null,
      opStamp: "9",
      delaySeconds: 10,
      timeZone: "330",
    });
    expect(h).toContain("GET OPTION FROM: X1");
    expect(h).toContain("TimeZone=330");
    expect(h).toContain("OPERLOGStamp=9");
    expect(h).toContain("OpStamp=9");
  });
  it("parses punches, users, fingerprints and results", () => {
    expect(
      parseAttLog("1001\t2026-10-25 06:09:12\t0\t1\t0\t0\t0\n")[0]
    ).toMatchObject({ pin: "1001", time: "2026-10-25 06:09:12", verify: 1 });
    const op = parseOperLog(
      "USER PIN=7\tName=A B\tPri=14\tPasswd=12\tCard=99\tGrp=1\tTZ=0\tVerify=0\nFP PIN=7\tFID=6\tSize=4\tValid=1\tTMP=QUJD"
    );
    expect(op[0]).toMatchObject({
      type: "user",
      user: { pin: "7", name: "A B", privilege: 14, card: "99" },
    });
    expect(op[1]).toMatchObject({
      type: "fp",
      fp: { pin: "7", fid: 6, template: "QUJD" },
    });
    expect(
      parseCommandResults("ID=5&Return=0&CMD=DATA\nID=6&Return=-1002&CMD=AC")
    ).toEqual([
      { id: 5, returnCode: 0, cmd: "DATA" },
      { id: 6, returnCode: -1002, cmd: "AC" },
    ]);
  });
  it("sends the full user record", () => {
    expect(
      cmdUpdateUser({
        pin: "7",
        name: "A=B\tC",
        privilege: 14,
        card: "99",
        password: "12",
      })
    ).toBe(
      "DATA UPDATE USERINFO PIN=7\tName=A B C\tPri=14\tPasswd=12\tCard=99\tGrp=1\tTZ=0000000000000000\tVerify=-1"
    );
  });
  it("reads machine times as India time", () => {
    const d = deviceTimeToDate("2026-10-25 06:09:12")!;
    expect(d.toISOString()).toBe("2026-10-25T00:39:12.000Z");
    expect(dateToDeviceTime(d)).toBe("2026-10-25 06:09:12");
    expect(todayIST(new Date("2026-10-24T18:30:00Z"))).toBe("2026-10-25");
  });
});
