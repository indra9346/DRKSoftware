// Fills the LOCAL dev database with fictitious sample data for exploring the
// app with the dev login. Refuses to run against anything but loopback, so it
// can never write sample members into the shared managed database.
//   pnpm dev:seed
import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  attendance,
  expenses,
  members,
  memberships,
  plans,
  progressEntries,
  users,
  workouts,
} from "../drizzle/schema";
import { ensureDevUsers, isLocalDatabaseUrl } from "../server/_core/devLogin";
import { addDays, getDb, recordPaymentInTransaction, todayIST } from "../server/db";

if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
  console.error("Refusing to seed: DATABASE_URL is not a localhost database.");
  process.exit(1);
}

const db = await getDb();
if (!db) throw new Error("Database is not available");

if ((await db.select({ id: plans.id }).from(plans).limit(1)).length) {
  console.log("Sample data already present; nothing to do.");
  process.exit(0);
}

await ensureDevUsers();
const userId = async (openId: string) =>
  (await db.select({ id: users.id }).from(users).where(eq(users.openId, openId)).limit(1))[0].id;
const ownerId = await userId("dev-owner");
const deskId = await userId("dev-frontdesk");
const trainerId = await userId("dev-trainer");

const today = todayIST();
const planRows = [
  { name: "Monthly", period: "monthly", durationDays: 30, price: 1500 },
  { name: "Quarterly", period: "quarterly", durationDays: 90, price: 4000 },
  { name: "Half-yearly", period: "half_yearly", durationDays: 180, price: 7500 },
  { name: "Yearly", period: "yearly", durationDays: 365, price: 13000 },
] as const;
const planIds: number[] = [];
for (const plan of planRows) {
  const [row] = await db.insert(plans).values({ ...plan, description: `${plan.name} access to all floors` });
  planIds.push(Number(row.insertId));
}

// [name, plan index, days since start, paid fully?, visits in last 20 days]
const roster: [string, number, number, boolean, number][] = [
  ["Aarav Sharma", 0, 5, true, 12],
  ["Diya Patel", 1, 40, true, 15],
  ["Kabir Mehta", 0, 27, true, 3], // expires in 3 days
  ["Ananya Iyer", 3, 120, true, 18],
  ["Rohan Gupta", 0, 41, true, 0], // expired 11 days ago
  ["Ishita Rao", 2, 60, false, 9], // part payment, dues outstanding
  ["Vihaan Nair", 0, 12, true, 0], // active but no visits
  ["Saanvi Reddy", 1, 85, true, 6], // expires in 5 days
  ["Arjun Singh", 0, 2, false, 2],
  ["Meera Joshi", 3, 300, true, 10],
];

const memberIds: number[] = [];
for (const [index, [name, planIndex, daysAgo, paidFully, visits]] of roster.entries()) {
  const plan = planRows[planIndex];
  const startDate = addDays(today, -daysAgo);
  const endDate = addDays(startDate, plan.durationDays - 1);
  const [memberRow] = await db.insert(members).values({
    memberCode: `SW-DEV${String(index + 1).padStart(4, "0")}`,
    name,
    phone: `+91 90000 ${String(10001 + index)}`,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    joiningDate: startDate,
    fitnessGoal: ["Fat loss", "Strength", "General fitness", "Muscle gain"][index % 4],
    heightCm: String(155 + (index * 3) % 30),
    trainerId: index % 3 === 0 ? trainerId : null,
  });
  const memberId = Number(memberRow.insertId);
  memberIds.push(memberId);

  const [membershipRow] = await db.insert(memberships).values({
    memberId,
    planId: planIds[planIndex],
    startDate,
    endDate,
    planName: plan.name,
    planPrice: plan.price,
    status: endDate < today ? "expired" : "active",
    createdBy: deskId,
  });
  await db.transaction(tx =>
    recordPaymentInTransaction(tx, {
      memberId,
      membershipId: Number(membershipRow.insertId),
      amount: paidFully ? plan.price : Math.round(plan.price / 2),
      mode: (["cash", "upi", "bank"] as const)[index % 3],
      notes: paidFully ? null : "Part payment",
      recordedBy: deskId,
    })
  );

  for (let day = 0, logged = 0; logged < visits && day < 20; day++) {
    if ((day + index) % 3 === 2) continue;
    await db.insert(attendance).values({
      memberId,
      checkInDate: addDays(today, -day),
      method: day % 2 ? "manual" : "qr",
      staffId: deskId,
    });
    logged++;
  }
}

for (const [i, memberId] of memberIds.filter((_, i) => i % 3 === 0).entries()) {
  await db.insert(workouts).values({
    memberId,
    trainerId,
    workoutDate: addDays(today, -i),
    title: ["Upper body push", "Lower body strength", "Full body conditioning"][i % 3],
    exercises: "Bench press 4x8\nOverhead press 3x10\nPush-ups 3x15",
    dietNotes: "Protein with every meal; 3L water",
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
  await db.insert(expenses).values({ expenseDate: addDays(today, -daysAgo), category, amount, description, enteredBy: ownerId });

// The member-portal dev user sees Aarav's profile.
await db.update(users).set({ linkedMemberId: memberIds[0] }).where(eq(users.openId, "dev-member"));

console.log(`Seeded ${planIds.length} plans, ${memberIds.length} members, payments, attendance, workouts and expenses.`);
process.exit(0);
