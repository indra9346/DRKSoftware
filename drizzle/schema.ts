import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", [
      "user",
      "admin",
      "owner",
      "receptionist",
      "trainer",
      "member",
    ])
      .default("user")
      .notNull(),
    active: boolean("active").default(true).notNull(),
    linkedMemberId: int("linkedMemberId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({
    linkedMemberUnique: uniqueIndex("users_linked_member_id_unique").on(
      table.linkedMemberId
    ),
  })
);

export const members = mysqlTable(
  "gym_members",
  {
    id: int("id").autoincrement().primaryKey(),
    memberCode: varchar("memberCode", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    email: varchar("email", { length: 320 }),
    dateOfBirth: varchar("dateOfBirth", { length: 10 }),
    emergencyContact: varchar("emergencyContact", { length: 160 }),
    joiningDate: varchar("joiningDate", { length: 10 }).notNull(),
    fitnessGoal: text("fitnessGoal"),
    heightCm: decimal("heightCm", { precision: 5, scale: 1 }),
    photoUrl: text("photoUrl"),
    status: mysqlEnum("status", ["active", "inactive", "frozen"])
      .default("active")
      .notNull(),
    trainerId: int("trainerId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    phoneIndex: index("gym_members_phone_idx").on(table.phone),
    nameIndex: index("gym_members_name_idx").on(table.name),
  })
);

export const plans = mysqlTable("gym_plans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  period: mysqlEnum("period", [
    "monthly",
    "quarterly",
    "half_yearly",
    "yearly",
    "custom",
  ])
    .default("monthly")
    .notNull(),
  durationDays: int("durationDays").notNull(),
  price: int("price").notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const memberships = mysqlTable(
  "gym_memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    planId: int("planId").notNull(),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }).notNull(),
    planName: varchar("planName", { length: 120 }).notNull(),
    planPrice: int("planPrice").notNull(),
    discount: int("discount").default(0).notNull(),
    status: mysqlEnum("status", ["active", "expired", "frozen", "cancelled"])
      .default("active")
      .notNull(),
    adminOverride: boolean("adminOverride").default(false).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    memberIdx: index("gym_memberships_member_idx").on(table.memberId),
    validityIdx: index("gym_memberships_validity_idx").on(
      table.status,
      table.endDate
    ),
  })
);

export const membershipFreezes = mysqlTable(
  "gym_membership_freezes",
  {
    id: int("id").autoincrement().primaryKey(),
    membershipId: int("membershipId").notNull(),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }),
    reason: varchar("reason", { length: 500 }).notNull(),
    extensionDays: int("extensionDays").default(0).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    membershipIdx: index("gym_freezes_membership_idx").on(table.membershipId),
  })
);

export const payments = mysqlTable(
  "gym_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    receiptNumber: varchar("receiptNumber", { length: 32 }).notNull().unique(),
    memberId: int("memberId").notNull(),
    membershipId: int("membershipId"),
    amount: int("amount").notNull(),
    mode: mysqlEnum("mode", ["cash", "upi", "bank"]).notNull(),
    notes: varchar("notes", { length: 500 }),
    status: mysqlEnum("status", ["posted", "reversed"])
      .default("posted")
      .notNull(),
    correctionReason: varchar("correctionReason", { length: 500 }),
    correctedBy: int("correctedBy"),
    correctedAt: timestamp("correctedAt"),
    recordedBy: int("recordedBy").notNull(),
    recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  },
  table => ({
    memberIdx: index("gym_payments_member_idx").on(table.memberId),
    membershipIdx: index("gym_payments_membership_idx").on(table.membershipId),
    timestampIdx: index("gym_payments_timestamp_idx").on(table.recordedAt),
  })
);

export const receiptCounters = mysqlTable("gym_receipt_counters", {
  period: varchar("period", { length: 6 }).primaryKey(),
  lastNumber: int("lastNumber").notNull(),
});

export const attendance = mysqlTable(
  "gym_attendance",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    checkInDate: varchar("checkInDate", { length: 10 }).notNull(),
    checkedInAt: timestamp("checkedInAt").defaultNow().notNull(),
    checkedOutAt: timestamp("checkedOutAt"),
    method: mysqlEnum("method", ["qr", "manual"]).default("manual").notNull(),
    staffId: int("staffId").notNull(),
  },
  table => ({
    oncePerDay: uniqueIndex("gym_attendance_member_day_unique").on(
      table.memberId,
      table.checkInDate
    ),
    dayIndex: index("gym_attendance_day_idx").on(table.checkInDate),
  })
);

export const renewalRequests = mysqlTable(
  "gym_renewal_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    planId: int("planId").notNull(),
    status: mysqlEnum("status", ["pending", "fulfilled", "cancelled"])
      .default("pending")
      .notNull(),
    requestedAt: timestamp("requestedAt").defaultNow().notNull(),
    handledBy: int("handledBy"),
    handledAt: timestamp("handledAt"),
  },
  table => ({
    memberIdx: index("gym_renewal_member_idx").on(table.memberId),
    statusIdx: index("gym_renewal_status_idx").on(
      table.status,
      table.requestedAt
    ),
  })
);

export const workouts = mysqlTable(
  "gym_workouts",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    trainerId: int("trainerId").notNull(),
    workoutDate: varchar("workoutDate", { length: 10 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    exercises: text("exercises"),
    dietNotes: text("dietNotes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    memberDateIdx: index("gym_workouts_member_date_idx").on(
      table.memberId,
      table.workoutDate
    ),
  })
);

export const progressEntries = mysqlTable(
  "gym_progress",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    trainerId: int("trainerId").notNull(),
    entryDate: varchar("entryDate", { length: 10 }).notNull(),
    weightKg: decimal("weightKg", { precision: 5, scale: 1 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    memberDateIdx: index("gym_progress_member_date_idx").on(
      table.memberId,
      table.entryDate
    ),
  })
);

export const expenses = mysqlTable(
  "gym_expenses",
  {
    id: int("id").autoincrement().primaryKey(),
    expenseDate: varchar("expenseDate", { length: 10 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    amount: int("amount").notNull(),
    description: varchar("description", { length: 500 }),
    enteredBy: int("enteredBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ dateIdx: index("gym_expenses_date_idx").on(table.expenseDate) })
);

export const followUps = mysqlTable(
  "gym_follow_ups",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    trigger: mysqlEnum("trigger", ["expiring", "inactive"]).notNull(),
    status: mysqlEnum("status", ["pending", "contacted", "follow_up"])
      .default("pending")
      .notNull(),
    notes: varchar("notes", { length: 1000 }),
    assignedTo: int("assignedTo"),
    updatedBy: int("updatedBy").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    memberTriggerUnique: uniqueIndex("gym_followup_member_trigger_unique").on(
      table.memberId,
      table.trigger
    ),
  })
);

export const staffInvites = mysqlTable("gym_staff_invites", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 160 }),
  role: mysqlEnum("role", ["receptionist", "trainer", "member"]).notNull(),
  linkedMemberId: int("linkedMemberId"),
  active: boolean("active").default(true).notNull(),
  acceptedAt: timestamp("acceptedAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const gymSettings = mysqlTable("gym_settings", {
  id: int("id").autoincrement().primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }),
  gymName: varchar("gymName", { length: 160 }).default("Fit Crush").notNull(),
  logoUrl: text("logoUrl"),
  address: varchar("address", { length: 500 }),
  contactPhone: varchar("contactPhone", { length: 32 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  businessDetails: varchar("businessDetails", { length: 500 }),
  currency: varchar("currency", { length: 3 }).default("INR").notNull(),
  timeZone: varchar("timeZone", { length: 64 })
    .default("Asia/Kolkata")
    .notNull(),
  expiryAlertDays: int("expiryAlertDays").default(7).notNull(),
  inactiveVisitDays: int("inactiveVisitDays").default(14).notNull(),
  planDefaults: text("planDefaults"),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const auditLogs = mysqlTable(
  "gym_audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actorId").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: int("entityId"),
    reason: varchar("reason", { length: 1000 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    entityIdx: index("gym_audit_entity_idx").on(
      table.entityType,
      table.entityId
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type GymMember = typeof members.$inferSelect;
export type GymPlan = typeof plans.$inferSelect;
