// Demo mode: fills an empty database with sample DRK Fitness Gym data and the demo logins
// shown on the sign-in page. All names, phone numbers and emails are fictitious.
import { eq } from "drizzle-orm";
import {
  attendance,
  deviceCommands,
  devices,
  deviceUsers,
  expenses,
  fingerprintTemplates,
  gymSettings,
  members,
  memberships,
  payments,
  plans,
  progressEntries,
  staffInvites,
  workouts,
} from "../../drizzle/schema";
import { makeOwner, setPassword, syncAccount } from "../_core/localAuth";
import { migrationsFolder, runMigrations } from "../_core/selfHost";
import {
  getBiometricSettings,
  linkMember,
  reconcileDevices,
  recordPunch,
  runAlerts,
  saveBiometricSettings,
  type Db,
} from "../biometric/engine";
import {
  addDays,
  getDb,
  getGymSettings,
  recordPaymentInTransaction,
  todayIST,
} from "../db";
import { DEMO_LOGINS } from "@shared/demo";
import { migrateDemoDatabase } from "./database";

const DEMO_MACHINE = "DRK-ENTRANCE-01";

/** Creates the tables and, on an empty database, the sample data. Safe to run on every start. */
export async function prepareDemo() {
  const db = await getDb();
  if (!db) throw new Error("Demo database is not available");
  if (process.env.DATABASE_URL) await runMigrations(process.env.DATABASE_URL);
  else await migrateDemoDatabase(migrationsFolder());
  if ((await db.select({ id: plans.id }).from(plans).limit(1)).length) return;
  const started = Date.now();
  await seedDemo(db as unknown as Db);
  console.log(
    `[Demo] Sample DRK Fitness Gym data ready in ${Date.now() - started} ms.`
  );
}

const istDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

async function seedDemo(db: Db) {
  const settings = await getGymSettings();
  if (settings)
    await db
      .update(gymSettings)
      .set({
        address: "Bengaluru, Karnataka",
        businessDetails: "Demo data: all members and payments are fictitious.",
      })
      .where(eq(gymSettings.id, settings.id));

  // Logins: the owner first (it becomes the gym's owner), staff through invitations.
  const [ownerLogin, deskLogin, trainerLogin, memberLogin] = DEMO_LOGINS;
  const owner = await setPassword(ownerLogin.email, ownerLogin.password);
  const ownerUser = await makeOwner(
    owner.openId,
    ownerLogin.email,
    ownerLogin.name
  );
  const ownerId = ownerUser!.id;
  const staff = async (
    login: (typeof DEMO_LOGINS)[number],
    role: "receptionist" | "trainer" | "member",
    linkedMemberId: number | null = null
  ) => {
    await db
      .insert(staffInvites)
      .values({
        email: login.email,
        name: login.name,
        role,
        linkedMemberId,
        createdBy: ownerId,
      });
    const { openId } = await setPassword(login.email, login.password);
    return (await syncAccount(openId, login.email))!.id;
  };
  const deskId = await staff(deskLogin, "receptionist");
  const trainerId = await staff(trainerLogin, "trainer");

  const today = todayIST();
  const planRows = [
    { name: "Monthly", period: "monthly", durationDays: 30, price: 1200 },
    { name: "Quarterly", period: "quarterly", durationDays: 90, price: 3300 },
    {
      name: "Half-yearly",
      period: "half_yearly",
      durationDays: 180,
      price: 6000,
    },
    { name: "Yearly", period: "yearly", durationDays: 365, price: 10000 },
  ] as const;
  const planIds: number[] = [];
  for (const plan of planRows) {
    const [row] = await db
      .insert(plans)
      .values({
        ...plan,
        description: `${plan.name} access to the gym floor and cardio`,
      })
      .returning({ id: plans.id });
    planIds.push(row.id);
  }

  // [name, plan, days since start, paid in full?, visits in the last 20 days]
  const roster: [string, number, number, boolean, number][] = [
    ["Aarav Sharma", 0, 5, true, 12],
    ["Diya Patel", 1, 40, true, 15],
    ["Kabir Mehta", 0, 27, true, 3], // ends in 3 days
    ["Ananya Iyer", 3, 120, true, 18],
    ["Rohan Gupta", 0, 41, true, 4], // expired: blocked at the door
    ["Ishita Rao", 2, 60, false, 9], // part payment, dues outstanding
    ["Vihaan Nair", 0, 12, true, 0], // active, no visits yet
    ["Saanvi Reddy", 1, 85, true, 6], // ends in 5 days
    ["Arjun Singh", 0, 2, false, 2],
    ["Meera Joshi", 3, 300, true, 10],
    ["Rahul Kumar", 0, 33, true, 7], // expired 3 days ago
    ["Sneha Gowda", 1, 20, true, 11],
    ["Manoj Shetty", 2, 150, true, 13],
    ["Pooja Hegde", 0, 15, false, 5],
    ["Nikhil Rao", 1, 70, true, 8],
  ];
  const memberIds: number[] = [];
  for (const [
    index,
    [name, planIndex, daysAgo, paidFully, visits],
  ] of roster.entries()) {
    const plan = planRows[planIndex];
    const startDate = addDays(today, -daysAgo);
    const endDate = addDays(startDate, plan.durationDays - 1);
    const [memberRow] = await db
      .insert(members)
      .values({
        memberCode: `DRK-DEMO${String(index + 1).padStart(4, "0")}`,
        name,
        phone: `+91 90000 ${String(10001 + index)}`,
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        joiningDate: startDate,
        fitnessGoal: ["Fat loss", "Strength", "General fitness", "Muscle gain"][
          index % 4
        ],
        heightCm: String(155 + ((index * 3) % 30)),
        trainerId: index % 3 === 0 ? trainerId : null,
      })
      .returning({ id: members.id });
    memberIds.push(memberRow.id);
    const [membershipRow] = await db
      .insert(memberships)
      .values({
        memberId: memberRow.id,
        planId: planIds[planIndex],
        startDate,
        endDate,
        planName: plan.name,
        planPrice: plan.price,
        status: endDate < today ? "expired" : "active",
        createdBy: deskId,
      })
      .returning({ id: memberships.id });
    const receipt = await db.transaction(tx =>
      recordPaymentInTransaction(tx, {
        memberId: memberRow.id,
        membershipId: membershipRow.id,
        amount: paidFully ? plan.price : Math.round(plan.price / 2),
        mode: (["cash", "upi", "bank"] as const)[index % 3],
        notes: paidFully ? null : "Part payment",
        recordedBy: deskId,
      })
    );
    // Paid when the plan started, not today.
    await db
      .update(payments)
      .set({ recordedAt: new Date(`${startDate}T10:30:00+05:30`) })
      .where(eq(payments.id, receipt.id));
    // Past visits (today's come from the fingerprint machine below).
    for (let day = 1, logged = 0; logged < visits && day < 21; day++) {
      if ((day + index) % 3 === 2) continue;
      await db.insert(attendance).values({
        memberId: memberRow.id,
        checkInDate: addDays(today, -day),
        method: day % 2 ? "biometric" : "manual",
        staffId: day % 2 ? 0 : deskId,
      });
      logged++;
    }
  }

  // The member login sees Aarav's profile.
  await staff(memberLogin, "member", memberIds[0]);

  for (const [i, memberId] of memberIds
    .filter((_, i) => i % 3 === 0)
    .entries()) {
    await db.insert(workouts).values({
      memberId,
      trainerId,
      workoutDate: addDays(today, -i),
      title: [
        "Upper body push",
        "Lower body strength",
        "Full body conditioning",
      ][i % 3],
      exercises: "Bench press 4x8\nOverhead press 3x10\nPush-ups 3x15",
      dietNotes: "Protein with every meal; 3 L water",
    });
    for (const weeksAgo of [6, 4, 2, 0])
      await db.insert(progressEntries).values({
        memberId,
        trainerId,
        entryDate: addDays(today, -weeksAgo * 7),
        weightKg: String(78 - i * 4 - (6 - weeksAgo) * 0.4),
      });
  }
  for (const [daysAgo, category, amount, description] of [
    [3, "Electricity", 8200, "Monthly power bill"],
    [8, "Maintenance", 3500, "Treadmill belt replacement"],
    [15, "Supplies", 1200, "Cleaning supplies"],
    [20, "Salary", 18000, "Trainer salary"],
  ] as const)
    await db
      .insert(expenses)
      .values({
        expenseDate: addDays(today, -daysAgo),
        category,
        amount,
        description,
        enteredBy: ownerId,
      });

  await seedMachine(db, memberIds, ownerId);
  await runAlerts(db, today);
}

/** An approved entrance machine with linked members, blocking switched on and today's punches. */
async function seedMachine(db: Db, memberIds: number[], ownerId: number) {
  const now = new Date();
  await db.insert(devices).values({
    sn: DEMO_MACHINE,
    name: "Entrance",
    status: "active",
    lastSeenAt: now,
    lastIp: "192.168.1.201",
    pushVersion: "2.4.1",
    info: JSON.stringify({
      firmware: "Ver 8.0.4 (demo)",
      users: memberIds.length,
      fingerprints: memberIds.length,
    }),
  });
  const settings = await getBiometricSettings(db);
  await saveBiometricSettings(db, {
    ...settings,
    machine: { ...settings.machine, enforce: true },
  });
  for (const [i, memberId] of memberIds.entries()) {
    const pin = 1001 + i;
    await db
      .insert(deviceUsers)
      .values({
        deviceSn: DEMO_MACHINE,
        pin: String(pin),
        name: `Member ${pin}`,
        privilege: 0,
        fingerprints: 1,
      });
    await db.insert(fingerprintTemplates).values({
      pin: String(pin),
      fid: 6,
      template: Buffer.from(`DRK-DEMO-TEMPLATE-${pin}`).toString("base64"),
      size: 40,
      valid: 1,
      sourceSn: DEMO_MACHINE,
    });
    await linkMember(db, memberId, pin, ownerId);
  }
  await reconcileDevices(db, { sn: DEMO_MACHINE, reason: "demo" });
  // As if the machine had already taken every update.
  await db
    .update(deviceCommands)
    .set({ status: "done", sentAt: now, doneAt: now, returnCode: 0 })
    .where(eq(deviceCommands.deviceSn, DEMO_MACHINE));

  // Today's punches, oldest first: index into the roster. Rohan (4) and Rahul (10) have
  // expired memberships, so they are refused at the door.
  const order = [3, 1, 11, 0, 4, 12, 9, 2, 14, 10, 7, 13];
  const current = await getBiometricSettings(db);
  for (const [n, index] of order.entries()) {
    const at = new Date(now.getTime() - (order.length - n) * 11 * 60_000);
    if (istDate(at) !== istDate(now)) continue; // only today's
    await recordPunch(
      db,
      DEMO_MACHINE,
      {
        pin: String(1001 + index),
        at,
        date: istDate(at),
        verify: 1,
        status: 0,
      },
      current
    );
  }
  await db
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.sn, DEMO_MACHINE));
}

/** The demo has no real machine: keep its "last contact" fresh so the screens show it online. */
export function startDemoMachineHeartbeat() {
  const beat = async () => {
    const db = await getDb();
    await db
      ?.update(devices)
      .set({ lastSeenAt: new Date() })
      .where(eq(devices.sn, DEMO_MACHINE));
  };
  setInterval(() => void beat().catch(() => undefined), 30_000).unref();
}
