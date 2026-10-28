import { isAdminRole, isFrontDeskRole } from "@shared/gym";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
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
  renewalRequests,
  staffInvites,
  loginCredentials,
  users,
  workouts,
} from "../drizzle/schema";
import {
  addDays,
  getDb,
  getGymSettings,
  getMemberByCodeOrId,
  listAttendance,
  listPayments,
  recordPaymentInTransaction,
  todayIST,
  isUniqueViolation,
  affectedRows,
} from "./db";
import {
  adminProcedure,
  protectedProcedure,
  roleProcedure,
  router,
} from "./_core/trpc";
import { ENV, localAuthEnabled } from "./_core/env";
import { BRAND, QR_PREFIX_PATTERN } from "@shared/brand";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().min(0).max(100_000_000);
const frontDesk = roleProcedure("owner", "admin", "receptionist");
const admin = adminProcedure;
const trainerOrAdmin = roleProcedure("owner", "admin", "trainer");
const dbRequired = async () => {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Gym database is unavailable.",
    });
  return db;
};
const getBootstrapOwnerOpenId = async () => {
  const settings = await getGymSettings();
  return ENV.ownerOpenId || settings?.ownerOpenId;
};
const startOfToday = (day: string) => new Date(`${day}T00:00:00+05:30`);
const endOfToday = (day: string) => new Date(`${day}T23:59:59+05:30`);
const REPORT_ROW_LIMIT = 5000;
const DUES_ROW_LIMIT = 20000;

async function verifyMemberAccess(
  actor: { id: number; role: string; linkedMemberId: number | null },
  memberId: number
) {
  if (actor.role === "member" && actor.linkedMemberId !== memberId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Members can access only their own records.",
    });
  if (actor.role === "trainer") {
    const db = await dbRequired();
    const found = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, memberId), eq(members.trainerId, actor.id)))
      .limit(1);
    if (!found.length)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This member is not assigned to you.",
      });
  }
}

export const gymRouter = router({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    const db = await dbRequired();
    const actor = ctx.user;
    const isAdmin = isAdminRole(actor.role);
    const isFrontDesk = isFrontDeskRole(actor.role);
    const day = todayIST();
    const storedSettings = await getGymSettings();
    const settings = storedSettings
      ? (({ ownerOpenId: _ownerOpenId, ...publicSettings }) => publicSettings)(
          storedSettings
        )
      : null;
    const limitWarnings: string[] = [];
    const takeRows = <T>(rows: T[], limit: number, label: string) => {
      if (rows.length > limit) limitWarnings.push(label);
      return rows.slice(0, limit);
    };
    const retentionLimit = 500;
    const expiryWindowEnd = addDays(day, storedSettings?.expiryAlertDays ?? 7);
    const inactiveCutoff = addDays(
      day,
      -(storedSettings?.inactiveVisitDays ?? 14)
    );
    const expiringRows = isFrontDesk
      ? takeRows(
          await db
            .select({ membership: memberships, member: members })
            .from(memberships)
            .innerJoin(members, eq(memberships.memberId, members.id))
            .where(
              and(
                eq(members.status, "active"),
                eq(memberships.status, "active"),
                lte(memberships.startDate, day),
                gte(memberships.endDate, day),
                lte(memberships.endDate, expiryWindowEnd)
              )
            )
            .orderBy(memberships.endDate)
            .limit(retentionLimit + 1),
          retentionLimit,
          "expiring memberships"
        )
      : [];
    const lastVisitByMember = db
      .select({
        memberId: attendance.memberId,
        lastVisit: sql<string | null>`MAX(${attendance.checkInDate})`.as(
          "lastVisit"
        ),
      })
      .from(attendance)
      .groupBy(attendance.memberId)
      .as("member_last_visit");
    const inactiveRows = isFrontDesk
      ? takeRows(
          await db
            .select({ member: members, lastVisit: lastVisitByMember.lastVisit })
            .from(members)
            .leftJoin(
              lastVisitByMember,
              eq(members.id, lastVisitByMember.memberId)
            )
            .where(
              and(
                eq(members.status, "active"),
                lte(members.joiningDate, inactiveCutoff),
                or(
                  sql`${lastVisitByMember.lastVisit} IS NULL`,
                  lte(lastVisitByMember.lastVisit, inactiveCutoff)
                )
              )
            )
            .orderBy(lastVisitByMember.lastVisit)
            .limit(retentionLimit + 1),
          retentionLimit,
          "inactive members"
        )
      : [];
    const memberRowLimit =
      actor.role === "member" ? 1 : actor.role === "trainer" ? 500 : 2000;
    let memberRows;
    if (actor.role === "member") {
      memberRows = actor.linkedMemberId
        ? await db
            .select()
            .from(members)
            .where(eq(members.id, actor.linkedMemberId))
            .limit(1)
        : [];
    } else if (actor.role === "trainer") {
      memberRows = await db
        .select()
        .from(members)
        .where(eq(members.trainerId, actor.id))
        .orderBy(desc(members.createdAt))
        .limit(memberRowLimit + 1);
    } else {
      memberRows = await db
        .select()
        .from(members)
        .orderBy(desc(members.createdAt))
        .limit(memberRowLimit + 1);
    }
    memberRows = takeRows(memberRows, memberRowLimit, "members");
    const memberIds = memberRows.map(row => row.id);
    const memberFilter =
      actor.role === "member" ? (actor.linkedMemberId ?? -1) : null;
    const memberScope =
      actor.role === "member"
        ? eq(members.id, actor.linkedMemberId ?? -1)
        : actor.role === "trainer"
          ? eq(members.trainerId, actor.id)
          : undefined;
    const membershipRowLimit =
      memberFilter !== null ? 100 : actor.role === "trainer" ? 1000 : 10000;
    let membershipRows = [] as (typeof memberships.$inferSelect)[];
    if (memberFilter !== null)
      membershipRows = await db
        .select()
        .from(memberships)
        .where(eq(memberships.memberId, memberFilter))
        .orderBy(desc(memberships.createdAt))
        .limit(membershipRowLimit + 1);
    else if (actor.role === "trainer")
      membershipRows = memberIds.length
        ? await db
            .select()
            .from(memberships)
            .where(inArray(memberships.memberId, memberIds))
            .orderBy(desc(memberships.createdAt))
            .limit(membershipRowLimit + 1)
        : [];
    else
      membershipRows = await db
        .select()
        .from(memberships)
        .orderBy(desc(memberships.createdAt))
        .limit(membershipRowLimit + 1);
    membershipRows = takeRows(
      membershipRows,
      membershipRowLimit,
      "membership history"
    );
    const membershipPaidTotals =
      isFrontDesk && membershipRows.length
        ? await db
            .select({
              membershipId: payments.membershipId,
              amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`.as(
                "amount"
              ),
            })
            .from(payments)
            .where(
              and(
                eq(payments.status, "posted"),
                inArray(
                  payments.membershipId,
                  membershipRows.map(item => item.id)
                )
              )
            )
            .groupBy(payments.membershipId)
        : [];

    const memberCondition =
      memberFilter !== null
        ? eq(payments.memberId, memberFilter)
        : actor.role === "trainer"
          ? memberIds.length
            ? inArray(payments.memberId, memberIds)
            : eq(payments.memberId, -1)
          : undefined;
    const paymentQuery = db
      .select({
        payment: payments,
        memberName: members.name,
        memberCode: members.memberCode,
      })
      .from(payments)
      .innerJoin(members, eq(payments.memberId, members.id));
    const paymentRowLimit = isAdmin ? 5000 : 500;
    const paymentRows = takeRows(
      actor.role === "trainer"
        ? []
        : memberCondition
          ? await paymentQuery
              .where(memberCondition)
              .orderBy(desc(payments.recordedAt))
              .limit(paymentRowLimit + 1)
          : await paymentQuery
              .orderBy(desc(payments.recordedAt))
              .limit(paymentRowLimit + 1),
      paymentRowLimit,
      "payment history"
    );

    const attendanceCondition =
      memberFilter !== null
        ? eq(attendance.memberId, memberFilter)
        : actor.role === "trainer"
          ? memberIds.length
            ? inArray(attendance.memberId, memberIds)
            : eq(attendance.memberId, -1)
          : undefined;
    const attendanceQuery = db
      .select({
        item: attendance,
        memberName: members.name,
        memberCode: members.memberCode,
      })
      .from(attendance)
      .innerJoin(members, eq(attendance.memberId, members.id));
    const attendanceRows = takeRows(
      attendanceCondition
        ? await attendanceQuery
            .where(attendanceCondition)
            .orderBy(desc(attendance.checkedInAt))
            .limit(2001)
        : await attendanceQuery
            .orderBy(desc(attendance.checkedInAt))
            .limit(2001),
      2000,
      "attendance history"
    );

    let planRows = [] as (typeof plans.$inferSelect)[];
    if (actor.role === "member")
      planRows = takeRows(
        await db
          .select()
          .from(plans)
          .where(eq(plans.active, true))
          .orderBy(plans.id)
          .limit(201),
        200,
        "plans"
      );
    else if (actor.role !== "trainer")
      planRows = takeRows(
        await db.select().from(plans).orderBy(plans.id).limit(201),
        200,
        "plans"
      );
    const expensesRows = isAdmin
      ? takeRows(
          await db
            .select()
            .from(expenses)
            .orderBy(desc(expenses.expenseDate))
            .limit(5001),
          5000,
          "expenses"
        )
      : [];
    let workoutRows = [] as (typeof workouts.$inferSelect)[];
    let progressRows = [] as (typeof progressEntries.$inferSelect)[];
    if (memberFilter !== null) {
      workoutRows = takeRows(
        await db
          .select()
          .from(workouts)
          .where(eq(workouts.memberId, memberFilter))
          .orderBy(desc(workouts.workoutDate))
          .limit(201),
        200,
        "workouts"
      );
      progressRows = takeRows(
        await db
          .select()
          .from(progressEntries)
          .where(eq(progressEntries.memberId, memberFilter))
          .orderBy(desc(progressEntries.entryDate))
          .limit(201),
        200,
        "progress history"
      );
    } else if (actor.role === "trainer") {
      workoutRows = takeRows(
        await db
          .select()
          .from(workouts)
          .where(
            and(
              eq(workouts.trainerId, actor.id),
              inArray(workouts.memberId, memberIds.length ? memberIds : [-1])
            )
          )
          .orderBy(desc(workouts.workoutDate))
          .limit(1001),
        1000,
        "workouts"
      );
      progressRows = takeRows(
        await db
          .select()
          .from(progressEntries)
          .where(
            and(
              eq(progressEntries.trainerId, actor.id),
              inArray(
                progressEntries.memberId,
                memberIds.length ? memberIds : [-1]
              )
            )
          )
          .orderBy(desc(progressEntries.entryDate))
          .limit(1001),
        1000,
        "progress history"
      );
    } else {
      workoutRows = takeRows(
        await db
          .select()
          .from(workouts)
          .orderBy(desc(workouts.workoutDate))
          .limit(2001),
        2000,
        "workouts"
      );
      progressRows = takeRows(
        await db
          .select()
          .from(progressEntries)
          .orderBy(desc(progressEntries.entryDate))
          .limit(2001),
        2000,
        "progress history"
      );
    }
    const followUpRows =
      isAdmin || actor.role === "receptionist"
        ? takeRows(
            await db
              .select()
              .from(followUps)
              .orderBy(desc(followUps.updatedAt))
              .limit(2001),
            2000,
            "follow-ups"
          )
        : [];
    const staffRows = isAdmin
      ? takeRows(
          await db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              active: users.active,
              linkedMemberId: users.linkedMemberId,
              lastSignedIn: users.lastSignedIn,
            })
            .from(users)
            .orderBy(desc(users.createdAt))
            .limit(501),
          500,
          "staff accounts"
        )
      : [];
    const inviteRows = isAdmin
      ? takeRows(
          await db
            .select()
            .from(staffInvites)
            .orderBy(desc(staffInvites.createdAt))
            .limit(501),
          500,
          "staff invitations"
        )
      : [];
    const renewalRequestRows =
      actor.role === "member"
        ? actor.linkedMemberId
          ? takeRows(
              await db
                .select({
                  request: renewalRequests,
                  member: members,
                  plan: plans,
                })
                .from(renewalRequests)
                .innerJoin(members, eq(renewalRequests.memberId, members.id))
                .leftJoin(plans, eq(renewalRequests.planId, plans.id))
                .where(eq(renewalRequests.memberId, actor.linkedMemberId))
                .orderBy(desc(renewalRequests.requestedAt))
                .limit(101),
              100,
              "renewal requests"
            )
          : []
        : isFrontDesk
          ? takeRows(
              await db
                .select({
                  request: renewalRequests,
                  member: members,
                  plan: plans,
                })
                .from(renewalRequests)
                .innerJoin(members, eq(renewalRequests.memberId, members.id))
                .leftJoin(plans, eq(renewalRequests.planId, plans.id))
                .where(eq(renewalRequests.status, "pending"))
                .orderBy(desc(renewalRequests.requestedAt))
                .limit(501),
              500,
              "renewal requests"
            )
          : [];
    const currentMonth = day.slice(0, 7);
    const monthStartKey = `${currentMonth}-01`;
    const [
      memberCountRows,
      membershipCountRows,
      registrationsCountRows,
      todayVisitsResult,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(members)
        .where(memberScope),
      db
        .select({
          active: sql<number>`COALESCE(SUM(CASE WHEN ${memberships.status} = 'active' AND ${memberships.startDate} <= ${day} AND ${memberships.endDate} >= ${day} THEN 1 ELSE 0 END), 0)::int`,
          expired: sql<number>`COALESCE(SUM(CASE WHEN ${memberships.status} <> 'cancelled' AND ${memberships.endDate} < ${day} THEN 1 ELSE 0 END), 0)::int`,
        })
        .from(memberships)
        .innerJoin(members, eq(memberships.memberId, members.id))
        .where(memberScope),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(members)
        .where(
          and(
            memberScope,
            gte(members.joiningDate, monthStartKey),
            lte(members.joiningDate, day)
          )
        ),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(attendance)
        .innerJoin(members, eq(attendance.memberId, members.id))
        .where(and(eq(attendance.checkInDate, day), memberScope)),
    ]);
    const memberCount = Number(memberCountRows[0]?.count ?? 0);
    const activeMembershipCount = Number(membershipCountRows[0]?.active ?? 0);
    const expiredMembershipCount = Number(membershipCountRows[0]?.expired ?? 0);
    const registrationsThisMonth = Number(
      registrationsCountRows[0]?.count ?? 0
    );
    const todayVisits = Number(todayVisitsResult[0]?.count ?? 0);
    const nextDay = startOfToday(addDays(day, 1));
    const monthStart = startOfToday(monthStartKey);
    const nextMonthKey =
      currentMonth === "9999-12"
        ? "9999-12-31"
        : (() => {
            const [year, month] = currentMonth.split("-").map(Number);
            return `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
          })();
    let todayCollected = 0;
    let monthCollected = 0;
    let pendingDues: number | null = null;
    let monthExpenses = 0;
    if (isAdmin) {
      const postedPaymentsByMembership = db
        .select({
          membershipId: payments.membershipId,
          amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`.as(
            "amount"
          ),
        })
        .from(payments)
        .where(eq(payments.status, "posted"))
        .groupBy(payments.membershipId)
        .as("posted_payments_by_membership");
      const [collectionTotals, duesTotals, expenseTotals] = await Promise.all([
        db
          .select({
            today: sql<number>`COALESCE(SUM(CASE WHEN ${payments.recordedAt} >= ${startOfToday(day)} AND ${payments.recordedAt} < ${nextDay} THEN ${payments.amount} ELSE 0 END), 0)::int`,
            month: sql<number>`COALESCE(SUM(CASE WHEN ${payments.recordedAt} >= ${monthStart} AND ${payments.recordedAt} < ${startOfToday(nextMonthKey)} THEN ${payments.amount} ELSE 0 END), 0)::int`,
          })
          .from(payments)
          .where(eq(payments.status, "posted")),
        db
          .select({
            total: sql<number>`COALESCE(SUM(GREATEST(0, ${memberships.planPrice} - ${memberships.discount} - COALESCE(${postedPaymentsByMembership.amount}, 0))), 0)::int`,
          })
          .from(memberships)
          .leftJoin(
            postedPaymentsByMembership,
            eq(memberships.id, postedPaymentsByMembership.membershipId)
          )
          .where(ne(memberships.status, "cancelled")),
        db
          .select({
            total: sql<number>`COALESCE(SUM(${expenses.amount}), 0)::int`,
          })
          .from(expenses)
          .where(
            and(
              gte(expenses.expenseDate, monthStartKey),
              lte(expenses.expenseDate, day)
            )
          ),
      ]);
      todayCollected = Number(collectionTotals[0]?.today ?? 0);
      monthCollected = Number(collectionTotals[0]?.month ?? 0);
      pendingDues = Number(duesTotals[0]?.total ?? 0);
      monthExpenses = Number(expenseTotals[0]?.total ?? 0);
    }
    const revenue = isAdmin
      ? {
          todayCollected,
          monthCollected,
          pendingDues,
          monthExpenses,
          monthNet: monthCollected - monthExpenses,
        }
      : null;

    return {
      actor: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
        active: actor.active,
        linkedMemberId: actor.linkedMemberId,
      },
      today: day,
      settings,
      members: memberRows,
      plans: planRows,
      memberships:
        actor.role === "trainer"
          ? membershipRows.map(item => ({ ...item, planPrice: 0, discount: 0 }))
          : membershipRows,
      membershipPaidTotals: isFrontDesk ? membershipPaidTotals : [],
      payments: paymentRows,
      attendance: attendanceRows,
      expenses: expensesRows,
      workouts: workoutRows,
      progress: progressRows,
      followUps: followUpRows,
      renewalRequests: renewalRequestRows,
      staff: staffRows,
      invites: inviteRows,
      // Self-hosted installs: which accounts already have a password.
      passwordEmails:
        isAdmin && localAuthEnabled()
          ? (
              await db
                .select({ email: loginCredentials.email })
                .from(loginCredentials)
            ).map(row => row.email)
          : [],
      retention: {
        expiring: expiringRows,
        inactive: inactiveRows,
      },
      limitsExceeded: limitWarnings,
      stats: {
        members: memberCount,
        activeMemberships: activeMembershipCount,
        expiredMemberships: expiredMembershipCount,
        registrationsThisMonth,
        todayVisits,
        revenue,
      },
    };
  }),

  reports: admin
    .input(z.object({ from: dateString.optional(), to: dateString.optional() }))
    .query(async ({ input }) => {
      const db = await dbRequired();
      const from = input.from ?? `${todayIST().slice(0, 7)}-01`;
      const to = input.to ?? todayIST();
      if (from > to)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The report start date must not be after its end date.",
        });
      const [
        paymentRows,
        expenseRows,
        attendanceRows,
        memberRows,
        membershipRows,
      ] = await Promise.all([
        listPayments(undefined, from, to, REPORT_ROW_LIMIT + 1),
        db
          .select()
          .from(expenses)
          .where(
            and(gte(expenses.expenseDate, from), lte(expenses.expenseDate, to))
          )
          .orderBy(desc(expenses.expenseDate))
          .limit(REPORT_ROW_LIMIT + 1),
        listAttendance(from, to, REPORT_ROW_LIMIT + 1),
        db
          .select()
          .from(members)
          .where(
            and(gte(members.joiningDate, from), lte(members.joiningDate, to))
          )
          .orderBy(desc(members.joiningDate))
          .limit(REPORT_ROW_LIMIT + 1),
        db
          .select()
          .from(memberships)
          .where(
            and(
              gte(memberships.startDate, from),
              lte(memberships.startDate, to)
            )
          )
          .orderBy(desc(memberships.startDate))
          .limit(REPORT_ROW_LIMIT + 1),
      ]);
      const [allMemberships, allPaidRows, allMembers] = await Promise.all([
        db
          .select()
          .from(memberships)
          .where(sql`${memberships.status} <> 'cancelled'`)
          .limit(DUES_ROW_LIMIT + 1),
        db
          .select({
            membershipId: payments.membershipId,
            amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
          })
          .from(payments)
          .where(eq(payments.status, "posted"))
          .groupBy(payments.membershipId),
        db
          .select({
            id: members.id,
            name: members.name,
            memberCode: members.memberCode,
          })
          .from(members)
          .limit(DUES_ROW_LIMIT + 1),
      ]);
      const paidByMembership = new Map<number, number>();
      for (const row of allPaidRows)
        if (row.membershipId)
          paidByMembership.set(row.membershipId, Number(row.amount));
      const reportPayments = paymentRows.slice(0, REPORT_ROW_LIMIT);
      const reportExpenses = expenseRows.slice(0, REPORT_ROW_LIMIT);
      const reportAttendance = attendanceRows.slice(0, REPORT_ROW_LIMIT);
      const reportMembers = memberRows.slice(0, REPORT_ROW_LIMIT);
      const rawReportMemberships = membershipRows.slice(0, REPORT_ROW_LIMIT);
      const membershipMemberIds = [
        ...new Set(rawReportMemberships.map(row => row.memberId)),
      ];
      const membershipMemberRows = membershipMemberIds.length
        ? await db
            .select({
              id: members.id,
              name: members.name,
              code: members.memberCode,
            })
            .from(members)
            .where(inArray(members.id, membershipMemberIds))
        : [];
      const membershipMemberById = new Map(
        membershipMemberRows.map(member => [member.id, member])
      );
      const reportMemberships = rawReportMemberships.map(row => ({
        ...row,
        memberName:
          membershipMemberById.get(row.memberId)?.name ?? "Unknown member",
        memberCode: membershipMemberById.get(row.memberId)?.code ?? "—",
      }));
      const currentMemberships = allMemberships.slice(0, DUES_ROW_LIMIT);
      const currentMembers = allMembers.slice(0, DUES_ROW_LIMIT);
      const overflowSections = [
        paymentRows.length > REPORT_ROW_LIMIT && "collections",
        expenseRows.length > REPORT_ROW_LIMIT && "expenses",
        attendanceRows.length > REPORT_ROW_LIMIT && "attendance",
        memberRows.length > REPORT_ROW_LIMIT && "registrations",
        membershipRows.length > REPORT_ROW_LIMIT && "memberships",
        (allMemberships.length > DUES_ROW_LIMIT ||
          allMembers.length > DUES_ROW_LIMIT) &&
          "current dues",
      ].filter((section): section is string => Boolean(section));
      const memberById = new Map(
        currentMembers.map(member => [member.id, member])
      );
      const dues = currentMemberships
        .map(membership => {
          const member = memberById.get(membership.memberId);
          return {
            membershipId: membership.id,
            memberName: member?.name ?? "Unknown member",
            memberCode: member?.memberCode ?? "—",
            planName: membership.planName,
            endDate: membership.endDate,
            amountDue: Math.max(
              0,
              membership.planPrice -
                membership.discount -
                (paidByMembership.get(membership.id) ?? 0)
            ),
          };
        })
        .filter(row => row.amountDue > 0);
      return {
        from,
        to,
        payments: reportPayments,
        expenses: reportExpenses,
        attendance: reportAttendance,
        registrations: reportMembers,
        memberships: reportMemberships,
        dues,
        truncated: overflowSections.length > 0,
        truncatedSections: overflowSections,
        totals: {
          collected: reportPayments
            .filter(row => row.payment.status === "posted")
            .reduce((sum, row) => sum + row.payment.amount, 0),
          expenses: reportExpenses.reduce((sum, row) => sum + row.amount, 0),
          visits: reportAttendance.length,
          registrations: reportMembers.length,
          dues: dues.reduce((sum, row) => sum + row.amountDue, 0),
        },
      };
    }),

  registerMember: frontDesk
    .input(
      z.object({
        name: z.string().trim().min(2).max(160),
        phone: z.string().trim().min(7).max(32),
        email: z.string().trim().email().max(320).optional().or(z.literal("")),
        dateOfBirth: dateString.optional().or(z.literal("")),
        emergencyContact: z.string().trim().max(160).optional(),
        joiningDate: dateString,
        fitnessGoal: z.string().max(2000).optional(),
        heightCm: z.number().min(50).max(260).optional(),
        photoUrl: z.string().max(1000).optional(),
        status: z.enum(["active", "inactive"]).default("active"),
        trainerId: z.number().int().positive().nullable().optional(),
        planId: z.number().int().positive().optional(),
        discount: amount.default(0),
        firstPayment: amount.default(0),
        mode: z.enum(["cash", "upi", "bank"]).default("cash"),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      return db.transaction(async tx => {
        if (input.trainerId) {
          const trainer = (
            await tx
              .select({ id: users.id, role: users.role, active: users.active })
              .from(users)
              .where(eq(users.id, input.trainerId))
              .for("update")
              .limit(1)
          )[0];
          if (!trainer || trainer.role !== "trainer" || !trainer.active)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Choose an active trainer account.",
            });
        }
        const duplicatePhones = await tx
          .select({
            id: members.id,
            name: members.name,
            memberCode: members.memberCode,
          })
          .from(members)
          .where(eq(members.phone, input.phone))
          .limit(5);
        if (!input.planId && (input.discount > 0 || input.firstPayment > 0))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose a membership plan before recording a discount or payment.",
          });
        const plan = input.planId
          ? (
              await tx
                .select()
                .from(plans)
                .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
                .for("update")
                .limit(1)
            )[0]
          : null;
        if (input.planId && !plan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Choose an active membership plan.",
          });
        if (plan && input.discount > plan.price)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Discount cannot exceed plan price.",
          });
        if (input.discount > 0 && !isAdminRole(ctx.user.role))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Discounts require admin authority.",
          });
        if (plan && input.firstPayment > plan.price - input.discount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment cannot exceed the amount due.",
          });

        const memberCode = `${BRAND.codePrefix}-${nanoid(8).toUpperCase()}`;
        const insertedMember = await tx
          .insert(members)
          .values({
            memberCode,
            name: input.name,
            phone: input.phone,
            email: input.email || null,
            dateOfBirth: input.dateOfBirth || null,
            emergencyContact: input.emergencyContact || null,
            joiningDate: input.joiningDate,
            fitnessGoal: input.fitnessGoal || null,
            heightCm: input.heightCm?.toFixed(1) ?? null,
            photoUrl: input.photoUrl || null,
            status: plan ? "active" : input.status,
            trainerId: input.trainerId ?? null,
          })
          .returning({ id: members.id });
        const memberId = insertedMember[0].id;
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "member.created",
          entityType: "member",
          entityId: memberId,
        });

        if (!plan)
          return {
            id: memberId,
            memberCode,
            duplicatePhones,
            membershipId: null,
            endDate: null,
            receipt: null,
          };

        const endDate = addDays(input.joiningDate, plan.durationDays - 1);
        const insertedMembership = await tx
          .insert(memberships)
          .values({
            memberId,
            planId: plan.id,
            startDate: input.joiningDate,
            endDate,
            planName: plan.name,
            planPrice: plan.price,
            discount: input.discount,
            status: "active",
            adminOverride: false,
            createdBy: ctx.user.id,
          })
          .returning({ id: memberships.id });
        const membershipId = insertedMembership[0].id;
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.assigned",
          entityType: "membership",
          entityId: membershipId,
        });
        const receipt =
          input.firstPayment > 0
            ? await recordPaymentInTransaction(tx, {
                memberId,
                membershipId,
                amount: input.firstPayment,
                mode: input.mode,
                notes: input.notes,
                recordedBy: ctx.user.id,
              })
            : null;
        return {
          id: memberId,
          memberCode,
          duplicatePhones,
          membershipId,
          endDate,
          receipt,
        };
      });
    }),

  saveMember: frontDesk
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(160),
        phone: z.string().trim().min(7).max(32),
        email: z.string().trim().email().max(320).optional().or(z.literal("")),
        dateOfBirth: dateString.optional().or(z.literal("")),
        emergencyContact: z.string().trim().max(160).optional(),
        joiningDate: dateString,
        fitnessGoal: z.string().max(2000).optional(),
        heightCm: z.number().min(50).max(260).optional(),
        photoUrl: z.string().max(1000).optional(),
        status: z.enum(["active", "inactive", "frozen"]).default("active"),
        trainerId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      return db.transaction(async tx => {
        if (input.trainerId) {
          const trainer = (
            await tx
              .select({ id: users.id, role: users.role, active: users.active })
              .from(users)
              .where(eq(users.id, input.trainerId))
              .for("update")
              .limit(1)
          )[0];
          if (!trainer || trainer.role !== "trainer" || !trainer.active)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Choose an active trainer account.",
            });
        }
        const existingMember = (
          await tx
            .select({ status: members.status })
            .from(members)
            .where(eq(members.id, input.id))
            .for("update")
            .limit(1)
        )[0];
        if (!existingMember)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member profile not found.",
          });
        if (input.status === "frozen" && existingMember.status !== "frozen")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use the audited membership-freeze action.",
          });
        const preservedStatus =
          existingMember.status === "frozen" ? "frozen" : input.status;
        const duplicatePhones = (
          await tx
            .select({
              id: members.id,
              name: members.name,
              memberCode: members.memberCode,
            })
            .from(members)
            .where(eq(members.phone, input.phone))
            .limit(5)
        ).filter(row => row.id !== input.id);
        await tx
          .update(members)
          .set({
            name: input.name,
            phone: input.phone,
            email: input.email || null,
            dateOfBirth: input.dateOfBirth || null,
            emergencyContact: input.emergencyContact || null,
            joiningDate: input.joiningDate,
            fitnessGoal: input.fitnessGoal || null,
            heightCm: input.heightCm?.toFixed(1) ?? null,
            photoUrl: input.photoUrl || null,
            status: preservedStatus,
            trainerId: input.trainerId ?? null,
          })
          .where(eq(members.id, input.id));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "member.updated",
          entityType: "member",
          entityId: input.id,
        });
        return { id: input.id, duplicatePhones };
      });
    }),

  savePlan: admin
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(2).max(120),
        period: z.enum([
          "monthly",
          "quarterly",
          "half_yearly",
          "yearly",
          "custom",
        ]),
        durationDays: z.number().int().min(1).max(3650),
        price: amount,
        description: z.string().max(2000).optional(),
        active: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      if (input.id) {
        await db
          .update(plans)
          .set({
            name: input.name,
            period: input.period,
            durationDays: input.durationDays,
            price: input.price,
            description: input.description || null,
            active: input.active,
          })
          .where(eq(plans.id, input.id));
        await db.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "plan.updated",
          entityType: "plan",
          entityId: input.id,
        });
        return { id: input.id };
      }
      const result = await db
        .insert(plans)
        .values({
          name: input.name,
          period: input.period,
          durationDays: input.durationDays,
          price: input.price,
          description: input.description || null,
          active: input.active,
        })
        .returning({ id: plans.id });
      return { id: result[0].id };
    }),

  assignMembership: frontDesk
    .input(
      z.object({
        memberId: z.number().int().positive(),
        planId: z.number().int().positive(),
        renewalRequestId: z.number().int().positive().optional(),
        startDate: dateString,
        discount: amount.default(0),
        firstPayment: amount.default(0),
        mode: z.enum(["cash", "upi", "bank"]).default("cash"),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id, status: members.status })
            .from(members)
            .where(eq(members.id, input.memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member profile not found.",
          });
        if (member.status === "frozen")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Reactivate the frozen membership before assigning or renewing a plan.",
          });
        if (input.renewalRequestId) {
          const request = (
            await tx
              .select()
              .from(renewalRequests)
              .where(eq(renewalRequests.id, input.renewalRequestId))
              .for("update")
              .limit(1)
          )[0];
          if (
            !request ||
            request.status !== "pending" ||
            request.memberId !== input.memberId ||
            request.planId !== input.planId
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This renewal request is no longer pending or its selected plan has changed.",
            });
        }
        const plan = (
          await tx
            .select()
            .from(plans)
            .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
            .for("update")
            .limit(1)
        )[0];
        if (!plan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Choose an active membership plan.",
          });
        if (input.discount > plan.price)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Discount cannot exceed plan price.",
          });
        if (input.discount > 0 && !isAdminRole(ctx.user.role))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Discounts require admin authority.",
          });
        if (input.firstPayment > plan.price - input.discount)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment cannot exceed the amount due.",
          });
        const today = todayIST();
        const current = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.memberId, input.memberId),
              eq(memberships.status, "active"),
              gte(memberships.endDate, today)
            )
          )
          .orderBy(desc(memberships.endDate))
          .limit(1);
        const overlaps =
          current.length > 0 && input.startDate <= current[0].endDate;
        if (overlaps && !isAdminRole(ctx.user.role))
          throw new TRPCError({
            code: "CONFLICT",
            message: `Membership is already valid through ${current[0].endDate}. Start the renewal after the current term or ask an admin to override.`,
          });
        if (overlaps)
          await tx.insert(auditLogs).values({
            actorId: ctx.user.id,
            action: "membership.overlap.override",
            entityType: "membership",
            entityId: current[0].id,
            reason: "Admin allowed overlapping validity window.",
          });
        const endDate = addDays(input.startDate, plan.durationDays - 1);
        const insertedMembership = await tx
          .insert(memberships)
          .values({
            memberId: input.memberId,
            planId: plan.id,
            startDate: input.startDate,
            endDate,
            planName: plan.name,
            planPrice: plan.price,
            discount: input.discount,
            status: "active",
            adminOverride: overlaps,
            createdBy: ctx.user.id,
          })
          .returning({ id: memberships.id });
        const membershipId = insertedMembership[0].id;
        await tx
          .update(members)
          .set({ status: "active" })
          .where(eq(members.id, input.memberId));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.assigned",
          entityType: "membership",
          entityId: membershipId,
        });
        const receipt =
          input.firstPayment > 0
            ? await recordPaymentInTransaction(tx, {
                memberId: input.memberId,
                membershipId,
                amount: input.firstPayment,
                mode: input.mode,
                notes: input.notes,
                recordedBy: ctx.user.id,
              })
            : null;
        if (input.renewalRequestId) {
          await tx
            .update(renewalRequests)
            .set({
              status: "fulfilled",
              handledBy: ctx.user.id,
              handledAt: new Date(),
            })
            .where(eq(renewalRequests.id, input.renewalRequestId));
          await tx.insert(auditLogs).values({
            actorId: ctx.user.id,
            action: "membership.renewal_request.fulfilled",
            entityType: "renewal_request",
            entityId: input.renewalRequestId,
            reason: `Membership ${membershipId} assigned through the staff workflow.`,
          });
        }
        return { membershipId, endDate, receipt };
      });
    }),

  freezeMembership: admin
    .input(
      z.object({
        membershipId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      const candidate = (
        await db
          .select({ memberId: memberships.memberId })
          .from(memberships)
          .where(eq(memberships.id, input.membershipId))
          .limit(1)
      )[0];
      if (!candidate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Membership not found.",
        });
      const today = todayIST();
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, candidate.memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Membership member profile not found.",
          });
        const record = (
          await tx
            .select()
            .from(memberships)
            .where(eq(memberships.id, input.membershipId))
            .for("update")
            .limit(1)
        )[0];
        if (!record)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Membership not found.",
          });
        if (
          record.status !== "active" ||
          record.startDate > today ||
          record.endDate < today
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only a currently valid active membership can be frozen.",
          });
        const overlapping = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.memberId, record.memberId),
              eq(memberships.status, "active"),
              ne(memberships.id, record.id),
              lte(memberships.startDate, record.endDate),
              gte(memberships.endDate, record.startDate)
            )
          )
          .limit(1);
        if (overlapping.length)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Another active membership overlaps this term. Resolve the overlap before freezing.",
          });
        await tx.insert(membershipFreezes).values({
          membershipId: record.id,
          startDate: today,
          reason: input.reason,
          createdBy: ctx.user.id,
        });
        await tx
          .update(memberships)
          .set({ status: "frozen" })
          .where(eq(memberships.id, record.id));
        await tx
          .update(members)
          .set({ status: "frozen" })
          .where(eq(members.id, record.memberId));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.frozen",
          entityType: "membership",
          entityId: record.id,
          reason: input.reason,
        });
        return { success: true };
      });
    }),

  reactivateMembership: admin
    .input(
      z.object({
        membershipId: z.number().int().positive(),
        extensionDays: z.number().int().min(0).max(365),
        reason: z.string().trim().min(3).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      const candidate = (
        await db
          .select({ memberId: memberships.memberId })
          .from(memberships)
          .where(eq(memberships.id, input.membershipId))
          .limit(1)
      )[0];
      if (!candidate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Frozen membership not found.",
        });
      const today = todayIST();
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, candidate.memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Frozen membership member profile not found.",
          });
        const record = (
          await tx
            .select()
            .from(memberships)
            .where(eq(memberships.id, input.membershipId))
            .for("update")
            .limit(1)
        )[0];
        if (!record || record.status !== "frozen")
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Frozen membership not found.",
          });
        const freezes = await tx
          .select()
          .from(membershipFreezes)
          .where(
            and(
              eq(membershipFreezes.membershipId, record.id),
              sql`${membershipFreezes.endDate} IS NULL`
            )
          )
          .orderBy(desc(membershipFreezes.id))
          .for("update")
          .limit(2);
        if (freezes.length !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Expected exactly one open freeze record; ask an admin to review the membership history.",
          });
        const endDate = addDays(record.endDate, input.extensionDays);
        const newStatus = endDate >= today ? "active" : "expired";
        await tx
          .update(membershipFreezes)
          .set({ endDate: today, extensionDays: input.extensionDays })
          .where(eq(membershipFreezes.id, freezes[0].id));
        await tx
          .update(memberships)
          .set({ endDate, status: newStatus })
          .where(eq(memberships.id, record.id));
        const [otherActive, otherFrozen] = await Promise.all([
          tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.memberId, record.memberId),
                eq(memberships.status, "active"),
                ne(memberships.id, record.id),
                lte(memberships.startDate, today),
                gte(memberships.endDate, today)
              )
            )
            .limit(1),
          tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.memberId, record.memberId),
                eq(memberships.status, "frozen"),
                ne(memberships.id, record.id),
                gte(memberships.endDate, today)
              )
            )
            .limit(1),
        ]);
        const memberStatus =
          newStatus === "active" || otherActive.length
            ? "active"
            : otherFrozen.length
              ? "frozen"
              : "inactive";
        await tx
          .update(members)
          .set({ status: memberStatus })
          .where(eq(members.id, record.memberId));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.reactivated",
          entityType: "membership",
          entityId: record.id,
          reason: `${input.extensionDays} day extension. ${input.reason}`,
        });
        return { success: true, endDate };
      });
    }),

  checkIn: roleProcedure("owner", "admin", "receptionist", "member")
    .input(
      z.object({
        lookup: z.string().trim().min(1).max(100),
        method: z.enum(["qr", "manual"]).default("manual"),
        override: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      const rawLookup = input.lookup.trim();
      // Badges printed under the earlier Fit Crush / Swan names still scan.
      const lookup = rawLookup.replace(QR_PREFIX_PATTERN, "");
      const member = await getMemberByCodeOrId(lookup).catch(error => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Member lookup failed.",
        });
      });
      if (!member)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No member found for that QR or ID.",
        });
      if (ctx.user.role === "member" && ctx.user.linkedMemberId !== member.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only check in your own linked member profile.",
        });
      if (ctx.user.role === "member" && input.override)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Members cannot override membership validity.",
        });
      if (member.status === "inactive")
        return {
          allowed: false,
          warning: "This member is inactive. Contact an admin before check-in.",
          member,
        };
      if (member.status === "frozen")
        return {
          allowed: false,
          warning:
            "This member is frozen. Reactivate the membership before check-in.",
          member,
        };
      const day = todayIST();
      const valid = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.memberId, member.id),
            eq(memberships.status, "active"),
            lte(memberships.startDate, day),
            gte(memberships.endDate, day)
          )
        )
        .limit(1);
      if (!valid.length) {
        if (!(input.override && isAdminRole(ctx.user.role)))
          return {
            allowed: false,
            warning:
              "Membership expired or not yet active. An admin can review and override this warning.",
            member,
          };
        await db.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "attendance.expired_override",
          entityType: "member",
          entityId: member.id,
          reason: "Admin override recorded during check-in.",
        });
      }
      const existing = await db
        .select()
        .from(attendance)
        .where(
          and(
            eq(attendance.memberId, member.id),
            eq(attendance.checkInDate, day)
          )
        )
        .limit(1);
      if (existing.length)
        return {
          allowed: false,
          duplicate: true,
          warning: "Already checked in today.",
          member,
        };
      try {
        await db.insert(attendance).values({
          memberId: member.id,
          checkInDate: day,
          method: input.method,
          staffId: ctx.user.id,
        });
      } catch (error) {
        if (isUniqueViolation(error))
          return {
            allowed: false,
            duplicate: true,
            warning: "Already checked in today.",
            member,
          };
        throw error;
      }
      return { allowed: true, member, checkedInAt: new Date().toISOString() };
    }),

  liveStatus: roleProcedure("owner", "admin", "receptionist", "member").query(
    async ({ ctx }) => {
      const db = await dbRequired();
      const day = todayIST();
      const [counts, ownVisits] = await Promise.all([
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(attendance)
          .where(
            and(
              eq(attendance.checkInDate, day),
              sql`${attendance.checkedOutAt} IS NULL`
            )
          ),
        ctx.user.role === "member" && ctx.user.linkedMemberId
          ? db
              .select()
              .from(attendance)
              .where(
                and(
                  eq(attendance.memberId, ctx.user.linkedMemberId),
                  eq(attendance.checkInDate, day),
                  sql`${attendance.checkedOutAt} IS NULL`
                )
              )
              .limit(1)
          : Promise.resolve([]),
      ]);
      return {
        today: day,
        liveCount: Number(counts[0]?.count ?? 0),
        ownVisit: ownVisits[0] ?? null,
      };
    }
  ),
  checkOut: roleProcedure("owner", "admin", "receptionist", "member")
    .input(z.object({ attendanceId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      return db.transaction(async tx => {
        const row = (
          await tx
            .select()
            .from(attendance)
            .where(eq(attendance.id, input.attendanceId))
            .for("update")
            .limit(1)
        )[0];
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Open attendance record not found.",
          });
        if (
          ctx.user.role === "member" &&
          ctx.user.linkedMemberId !== row.memberId
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only check out your own linked member profile.",
          });
        if (row.checkInDate !== todayIST())
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only today's open gym visit can be checked out.",
          });
        if (row.checkedOutAt)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This gym visit has already been checked out.",
          });
        const checkedOutAt = new Date();
        const updated = await tx
          .update(attendance)
          .set({ checkedOutAt })
          .where(
            and(
              eq(attendance.id, input.attendanceId),
              sql`${attendance.checkedOutAt} IS NULL`
            )
          );
        if (!affectedRows(updated))
          throw new TRPCError({
            code: "CONFLICT",
            message: "This gym visit has already been checked out.",
          });
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "attendance.checked_out",
          entityType: "attendance",
          entityId: row.id,
          reason: ctx.user.role === "member" ? "Member portal checkout." : null,
        });
        return { success: true, checkedOutAt };
      });
    }),
  requestRenewal: roleProcedure("member")
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const memberId = ctx.user.linkedMemberId;
      if (!memberId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Ask the gym to link your login to your member profile first.",
        });
      const db = await dbRequired();
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id, status: members.status })
            .from(members)
            .where(eq(members.id, memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member || member.status !== "active")
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only an active member profile can request a renewal.",
          });
        const plan = (
          await tx
            .select({ id: plans.id })
            .from(plans)
            .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
            .for("update")
            .limit(1)
        )[0];
        if (!plan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Choose an active membership plan.",
          });
        const pending = (
          await tx
            .select({ id: renewalRequests.id })
            .from(renewalRequests)
            .where(
              and(
                eq(renewalRequests.memberId, memberId),
                eq(renewalRequests.status, "pending")
              )
            )
            .limit(1)
        )[0];
        if (pending)
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already have a renewal request awaiting the gym.",
          });
        const inserted = await tx
          .insert(renewalRequests)
          .values({
            memberId,
            planId: plan.id,
          })
          .returning({ id: renewalRequests.id });
        const requestId = inserted[0].id;
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.renewal_requested",
          entityType: "renewal_request",
          entityId: requestId,
        });
        return { requestId };
      });
    }),
  closeUnavailableRenewalRequest: frontDesk
    .input(z.object({ requestId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      return db.transaction(async tx => {
        const request = (
          await tx
            .select()
            .from(renewalRequests)
            .where(eq(renewalRequests.id, input.requestId))
            .for("update")
            .limit(1)
        )[0];
        if (!request || request.status !== "pending")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This renewal request is no longer pending.",
          });
        const requestedPlan = (
          await tx
            .select({ active: plans.active })
            .from(plans)
            .where(eq(plans.id, request.planId))
            .for("update")
            .limit(1)
        )[0];
        if (requestedPlan?.active)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request uses an active plan and should be processed normally.",
          });
        await tx
          .update(renewalRequests)
          .set({
            status: "cancelled",
            handledBy: ctx.user.id,
            handledAt: new Date(),
          })
          .where(eq(renewalRequests.id, input.requestId));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "membership.renewal_request.cancelled",
          entityType: "renewal_request",
          entityId: input.requestId,
          reason:
            "Requested plan is no longer active; member may choose an active plan and submit a new renewal request.",
        });
        return { success: true };
      });
    }),
  savePayment: frontDesk
    .input(
      z.object({
        memberId: z.number().int().positive(),
        membershipId: z.number().int().positive().optional(),
        amount,
        mode: z.enum(["cash", "upi", "bank"]),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.amount <= 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Enter an amount greater than zero.",
        });
      const db = await dbRequired();
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, input.memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member profile not found.",
          });
        if (input.membershipId) {
          const membership = (
            await tx
              .select()
              .from(memberships)
              .where(eq(memberships.id, input.membershipId))
              .for("update")
              .limit(1)
          )[0];
          if (!membership || membership.memberId !== input.memberId)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Membership not found for this member.",
            });
          if (membership.status === "cancelled")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot record a payment against a cancelled membership.",
            });
          const existing = await tx
            .select({
              total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int`,
            })
            .from(payments)
            .where(
              and(
                eq(payments.membershipId, membership.id),
                eq(payments.status, "posted")
              )
            );
          const due = Math.max(
            0,
            membership.planPrice -
              membership.discount -
              Number(existing[0]?.total ?? 0)
          );
          if (input.amount > due)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Payment exceeds the remaining balance of ₹${due.toLocaleString("en-IN")}.`,
            });
        }
        return recordPaymentInTransaction(tx, {
          ...input,
          recordedBy: ctx.user.id,
        });
      });
    }),

  correctPayment: admin
    .input(
      z.object({
        paymentId: z.number().int().positive(),
        reason: z.string().trim().min(5).max(500),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await dbRequired();
      const candidate = (
        await db
          .select({ memberId: payments.memberId })
          .from(payments)
          .where(eq(payments.id, input.paymentId))
          .limit(1)
      )[0];
      if (!candidate)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found.",
        });
      return db.transaction(async tx => {
        const member = (
          await tx
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, candidate.memberId))
            .for("update")
            .limit(1)
        )[0];
        if (!member)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Payment member profile not found.",
          });
        const payment = (
          await tx
            .select()
            .from(payments)
            .where(eq(payments.id, input.paymentId))
            .for("update")
            .limit(1)
        )[0];
        if (!payment)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Payment not found.",
          });
        if (payment.status === "reversed")
          throw new TRPCError({
            code: "CONFLICT",
            message: "This payment is already corrected.",
          });
        await tx
          .update(payments)
          .set({
            status: "reversed",
            correctionReason: input.reason,
            correctedBy: ctx.user.id,
            correctedAt: new Date(),
          })
          .where(eq(payments.id, input.paymentId));
        await tx.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "payment.reversed",
          entityType: "payment",
          entityId: input.paymentId,
          reason: input.reason,
        });
        return { success: true };
      });
    }),

  saveExpense: admin
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        expenseDate: dateString,
        category: z.string().trim().min(2).max(100),
        amount: z.number().int().positive().max(100_000_000),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      if (input.id) {
        await db
          .update(expenses)
          .set({
            expenseDate: input.expenseDate,
            category: input.category,
            amount: input.amount,
            description: input.description || null,
          })
          .where(eq(expenses.id, input.id));
        await db.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "expense.updated",
          entityType: "expense",
          entityId: input.id,
        });
        return { id: input.id };
      }
      const result = await db
        .insert(expenses)
        .values({
          expenseDate: input.expenseDate,
          category: input.category,
          amount: input.amount,
          description: input.description || null,
          enteredBy: ctx.user.id,
        })
        .returning({ id: expenses.id });
      return { id: result[0].id };
    }),

  saveWorkout: trainerOrAdmin
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        memberId: z.number().int().positive(),
        workoutDate: dateString,
        title: z.string().trim().min(2).max(160),
        exercises: z.string().max(5000).optional(),
        dietNotes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await verifyMemberAccess(ctx.user, input.memberId);
      const db = await dbRequired();
      if (input.id) {
        const existing = (
          await db
            .select()
            .from(workouts)
            .where(eq(workouts.id, input.id))
            .limit(1)
        )[0];
        if (
          !existing ||
          existing.memberId !== input.memberId ||
          (ctx.user.role === "trainer" && existing.trainerId !== ctx.user.id)
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workout not found for this member.",
          });
        await db
          .update(workouts)
          .set({
            workoutDate: input.workoutDate,
            title: input.title,
            exercises: input.exercises || null,
            dietNotes: input.dietNotes || null,
          })
          .where(eq(workouts.id, input.id));
        return { id: input.id };
      }
      const result = await db
        .insert(workouts)
        .values({
          memberId: input.memberId,
          trainerId: ctx.user.id,
          workoutDate: input.workoutDate,
          title: input.title,
          exercises: input.exercises || null,
          dietNotes: input.dietNotes || null,
        })
        .returning({ id: workouts.id });
      return { id: result[0].id };
    }),

  saveProgress: trainerOrAdmin
    .input(
      z.object({
        memberId: z.number().int().positive(),
        entryDate: dateString,
        weightKg: z.number().min(20).max(500),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await verifyMemberAccess(ctx.user, input.memberId);
      const db = await dbRequired();
      const result = await db
        .insert(progressEntries)
        .values({
          memberId: input.memberId,
          trainerId: ctx.user.id,
          entryDate: input.entryDate,
          weightKg: input.weightKg.toFixed(1),
          notes: input.notes || null,
        })
        .returning({ id: progressEntries.id });
      return { id: result[0].id };
    }),

  updateFollowUp: roleProcedure("owner", "admin", "receptionist")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        trigger: z.enum(["expiring", "inactive"]),
        status: z.enum(["pending", "contacted", "follow_up"]),
        notes: z.string().max(1000).optional(),
        assignedTo: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      const existing = (
        await db
          .select()
          .from(followUps)
          .where(
            and(
              eq(followUps.memberId, input.memberId),
              eq(followUps.trigger, input.trigger)
            )
          )
          .limit(1)
      )[0];
      if (existing)
        await db
          .update(followUps)
          .set({
            status: input.status,
            notes: input.notes || null,
            assignedTo: input.assignedTo ?? null,
            updatedBy: ctx.user.id,
          })
          .where(eq(followUps.id, existing.id));
      else
        await db.insert(followUps).values({
          memberId: input.memberId,
          trigger: input.trigger,
          status: input.status,
          notes: input.notes || null,
          assignedTo: input.assignedTo ?? null,
          updatedBy: ctx.user.id,
        });
      return { success: true };
    }),

  saveSettings: admin
    .input(
      z.object({
        gymName: z.string().trim().min(2).max(160),
        logoUrl: z
          .union([
            z.literal(""),
            z
              .string()
              .trim()
              .url()
              .max(1000)
              .refine(value => value.toLowerCase().startsWith("https://")),
          ])
          .optional(),
        address: z.string().max(500).optional(),
        contactPhone: z.string().max(32).optional(),
        contactEmail: z.string().email().max(320).optional().or(z.literal("")),
        businessDetails: z.string().max(500).optional(),
        expiryAlertDays: z.number().int().min(1).max(90),
        inactiveVisitDays: z.number().int().min(1).max(365),
        planDefaults: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      const values = {
        gymName: input.gymName,
        logoUrl: input.logoUrl || null,
        address: input.address || null,
        contactPhone: input.contactPhone || null,
        contactEmail: input.contactEmail || null,
        businessDetails: input.businessDetails || null,
        expiryAlertDays: input.expiryAlertDays,
        inactiveVisitDays: input.inactiveVisitDays,
        planDefaults: input.planDefaults || null,
        updatedBy: ctx.user.id,
      };
      const current = await getGymSettings();
      if (current)
        await db
          .update(gymSettings)
          .set(values)
          .where(eq(gymSettings.id, current.id));
      else await db.insert(gymSettings).values({ id: 1, ...values });
      return { success: true };
    }),

  inviteStaff: admin
    .input(
      z.object({
        email: z.string().trim().email().max(320),
        name: z.string().trim().max(160).optional(),
        role: z.enum(["receptionist", "trainer", "member"]),
        linkedMemberId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      const email = input.email.trim().toLowerCase();
      if (input.linkedMemberId && input.role !== "member")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a member login can be linked to a member profile.",
        });
      if (input.role === "member" && input.linkedMemberId) {
        const linkedMember = (
          await db
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, input.linkedMemberId))
            .limit(1)
        )[0];
        if (!linkedMember)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member profile not found.",
          });
        const linkedAccount = (
          await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.linkedMemberId, input.linkedMemberId))
            .limit(1)
        )[0];
        if (
          linkedAccount &&
          linkedAccount.email?.trim().toLowerCase() !== email
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This member profile is already linked to another login.",
          });
        const pendingLink = (
          await db
            .select({ email: staffInvites.email })
            .from(staffInvites)
            .where(
              and(
                eq(staffInvites.linkedMemberId, input.linkedMemberId),
                eq(staffInvites.active, true)
              )
            )
            .limit(1)
        )[0];
        if (pendingLink && pendingLink.email.toLowerCase() !== email)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This member profile is already linked to another invite.",
          });
      }
      const existingUser = (
        await db.select().from(users).where(eq(users.email, email)).limit(1)
      )[0];
      if (existingUser) {
        if (existingUser.openId === (await getBootstrapOwnerOpenId())) {
          await db.insert(auditLogs).values({
            actorId: ctx.user.id,
            action: "staff.owner_assignment.denied",
            entityType: "user",
            entityId: existingUser.id,
            reason: `Attempted role assignment: ${input.role}`,
          });
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "The bootstrap owner account cannot be reassigned through staff invitations.",
          });
        }
        await db
          .update(users)
          .set({
            role: input.role,
            active: true,
            linkedMemberId: input.linkedMemberId ?? null,
            name: input.name || existingUser.name,
          })
          .where(eq(users.id, existingUser.id));
        await db.insert(auditLogs).values({
          actorId: ctx.user.id,
          action: "staff.role_assigned",
          entityType: "user",
          entityId: existingUser.id,
          reason: input.role,
        });
        return { status: "assigned" as const, userId: existingUser.id };
      }
      const existingInvite = (
        await db
          .select()
          .from(staffInvites)
          .where(eq(staffInvites.email, email))
          .limit(1)
      )[0];
      if (existingInvite)
        await db
          .update(staffInvites)
          .set({
            name: input.name || null,
            role: input.role,
            linkedMemberId: input.linkedMemberId ?? null,
            active: true,
            acceptedAt: null,
          })
          .where(eq(staffInvites.id, existingInvite.id));
      else
        await db.insert(staffInvites).values({
          email,
          name: input.name || null,
          role: input.role,
          linkedMemberId: input.linkedMemberId ?? null,
          createdBy: ctx.user.id,
        });
      return { status: "invited" as const };
    }),

  updateStaff: admin
    .input(
      z.object({
        userId: z.number().int().positive(),
        role: z.enum(["receptionist", "trainer", "member", "admin"]),
        active: z.boolean(),
        linkedMemberId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await dbRequired();
      if (ctx.user.id === input.userId && !input.active)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot deactivate your own account.",
        });
      if (ctx.user.id === input.userId && input.role !== "admin")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove your own administrator role.",
        });
      const target = (
        await db.select().from(users).where(eq(users.id, input.userId)).limit(1)
      )[0];
      if (!target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found.",
        });
      const settings = await getGymSettings();
      const ownerOpenId = ENV.ownerOpenId || settings?.ownerOpenId;
      if (
        target.openId === ownerOpenId &&
        (input.role !== "admin" || !input.active)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "The initial owner account cannot be demoted or deactivated here.",
        });
      if (input.linkedMemberId) {
        if (input.role !== "member")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only a member login can be linked to a member profile.",
          });
        const linkedMember = (
          await db
            .select({ id: members.id })
            .from(members)
            .where(eq(members.id, input.linkedMemberId))
            .limit(1)
        )[0];
        if (!linkedMember)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member profile not found.",
          });
        const otherAccount = (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.linkedMemberId, input.linkedMemberId))
            .limit(1)
        )[0];
        if (otherAccount && otherAccount.id !== target.id)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This member profile is already linked to another login.",
          });
      }
      await db
        .update(users)
        .set({
          role: input.role,
          active: input.active,
          linkedMemberId: input.linkedMemberId ?? null,
        })
        .where(eq(users.id, input.userId));
      await db.insert(auditLogs).values({
        actorId: ctx.user.id,
        action: "staff.updated",
        entityType: "user",
        entityId: input.userId,
        reason: `${input.role}; ${input.active ? "active" : "inactive"}`,
      });
      return { success: true };
    }),

  cancelInvite: admin
    .input(z.object({ inviteId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await dbRequired();
      await db.delete(staffInvites).where(eq(staffInvites.id, input.inviteId));
      return { success: true };
    }),

  portalReceipt: roleProcedure("owner", "admin", "receptionist", "member")
    .input(z.object({ paymentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await dbRequired();
      const row = (
        await db
          .select({ payment: payments, member: members })
          .from(payments)
          .innerJoin(members, eq(payments.memberId, members.id))
          .where(eq(payments.id, input.paymentId))
          .limit(1)
      )[0];
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found.",
        });
      if (row.payment.status !== "posted")
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Receipt not found.",
        });
      await verifyMemberAccess(ctx.user, row.member.id);
      return row;
    }),
});
