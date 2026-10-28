// PostgreSQL (Supabase) schema. Column names keep their original camelCase spelling.
// updatedAt columns are refreshed by a database trigger (see the supabase_hardening
// migration), like MySQL's ON UPDATE CURRENT_TIMESTAMP before the move.
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// Every timestamp is stored with its time zone, so the server's own zone never shifts it.
const withTimezone = { withTimezone: true } as const;

export const userRole = pgEnum("user_role", [
  "user",
  "admin",
  "owner",
  "receptionist",
  "trainer",
  "member",
]);
export const memberStatus = pgEnum("member_status", [
  "active",
  "inactive",
  "frozen",
]);
export const planPeriod = pgEnum("plan_period", [
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "custom",
]);
export const membershipStatus = pgEnum("membership_status", [
  "active",
  "expired",
  "frozen",
  "cancelled",
]);
export const paymentMode = pgEnum("payment_mode", ["cash", "upi", "bank"]);
export const paymentStatus = pgEnum("payment_status", ["posted", "reversed"]);
export const attendanceMethod = pgEnum("attendance_method", [
  "qr",
  "manual",
  "biometric",
]);
export const renewalStatus = pgEnum("renewal_status", [
  "pending",
  "fulfilled",
  "cancelled",
]);
export const followUpTrigger = pgEnum("follow_up_trigger", [
  "expiring",
  "inactive",
]);
export const followUpStatus = pgEnum("follow_up_status", [
  "pending",
  "contacted",
  "follow_up",
]);
export const inviteRole = pgEnum("invite_role", [
  "receptionist",
  "trainer",
  "member",
]);
export const accessOverride = pgEnum("access_override", ["allow", "block"]);
export const deviceStatus = pgEnum("device_status", [
  "pending",
  "active",
  "disabled",
]);
export const deviceCommandStatus = pgEnum("device_command_status", [
  "queued",
  "sent",
  "done",
  "failed",
  "cancelled",
]);
export const alertStatus = pgEnum("alert_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: userRole("role").default("user").notNull(),
    active: boolean("active").default(true).notNull(),
    linkedMemberId: integer("linkedMemberId"),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn", withTimezone)
      .defaultNow()
      .notNull(),
  },
  table => ({
    linkedMemberUnique: uniqueIndex("users_linked_member_id_unique").on(
      table.linkedMemberId
    ),
  })
);

export const members = pgTable(
  "gym_members",
  {
    id: serial("id").primaryKey(),
    memberCode: varchar("memberCode", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    email: varchar("email", { length: 320 }),
    dateOfBirth: varchar("dateOfBirth", { length: 10 }),
    emergencyContact: varchar("emergencyContact", { length: 160 }),
    joiningDate: varchar("joiningDate", { length: 10 }).notNull(),
    fitnessGoal: text("fitnessGoal"),
    heightCm: numeric("heightCm", { precision: 5, scale: 1 }),
    photoUrl: text("photoUrl"),
    status: memberStatus("status").default("active").notNull(),
    trainerId: integer("trainerId"),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    phoneIndex: index("gym_members_phone_idx").on(table.phone),
    nameIndex: index("gym_members_name_idx").on(table.name),
  })
);

export const plans = pgTable("gym_plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  period: planPeriod("period").default("monthly").notNull(),
  durationDays: integer("durationDays").notNull(),
  price: integer("price").notNull(),
  description: text("description"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
});

export const memberships = pgTable(
  "gym_memberships",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    planId: integer("planId").notNull(),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }).notNull(),
    planName: varchar("planName", { length: 120 }).notNull(),
    planPrice: integer("planPrice").notNull(),
    discount: integer("discount").default(0).notNull(),
    status: membershipStatus("status").default("active").notNull(),
    adminOverride: boolean("adminOverride").default(false).notNull(),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    memberIdx: index("gym_memberships_member_idx").on(table.memberId),
    validityIdx: index("gym_memberships_validity_idx").on(
      table.status,
      table.endDate
    ),
  })
);

export const membershipFreezes = pgTable(
  "gym_membership_freezes",
  {
    id: serial("id").primaryKey(),
    membershipId: integer("membershipId").notNull(),
    startDate: varchar("startDate", { length: 10 }).notNull(),
    endDate: varchar("endDate", { length: 10 }),
    reason: varchar("reason", { length: 500 }).notNull(),
    extensionDays: integer("extensionDays").default(0).notNull(),
    createdBy: integer("createdBy").notNull(),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    membershipIdx: index("gym_freezes_membership_idx").on(table.membershipId),
  })
);

export const payments = pgTable(
  "gym_payments",
  {
    id: serial("id").primaryKey(),
    receiptNumber: varchar("receiptNumber", { length: 32 }).notNull().unique(),
    memberId: integer("memberId").notNull(),
    membershipId: integer("membershipId"),
    amount: integer("amount").notNull(),
    mode: paymentMode("mode").notNull(),
    notes: varchar("notes", { length: 500 }),
    status: paymentStatus("status").default("posted").notNull(),
    correctionReason: varchar("correctionReason", { length: 500 }),
    correctedBy: integer("correctedBy"),
    correctedAt: timestamp("correctedAt", withTimezone),
    recordedBy: integer("recordedBy").notNull(),
    recordedAt: timestamp("recordedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    memberIdx: index("gym_payments_member_idx").on(table.memberId),
    membershipIdx: index("gym_payments_membership_idx").on(table.membershipId),
    timestampIdx: index("gym_payments_timestamp_idx").on(table.recordedAt),
  })
);

export const receiptCounters = pgTable("gym_receipt_counters", {
  period: varchar("period", { length: 6 }).primaryKey(),
  lastNumber: integer("lastNumber").notNull(),
});

export const attendance = pgTable(
  "gym_attendance",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    checkInDate: varchar("checkInDate", { length: 10 }).notNull(),
    checkedInAt: timestamp("checkedInAt", withTimezone).defaultNow().notNull(),
    checkedOutAt: timestamp("checkedOutAt", withTimezone),
    // biometric = recorded by the fingerprint machine at the entrance (staffId 0).
    method: attendanceMethod("method").default("manual").notNull(),
    staffId: integer("staffId").notNull(),
  },
  table => ({
    oncePerDay: uniqueIndex("gym_attendance_member_day_unique").on(
      table.memberId,
      table.checkInDate
    ),
    dayIndex: index("gym_attendance_day_idx").on(table.checkInDate),
  })
);

export const renewalRequests = pgTable(
  "gym_renewal_requests",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    planId: integer("planId").notNull(),
    status: renewalStatus("status").default("pending").notNull(),
    requestedAt: timestamp("requestedAt", withTimezone).defaultNow().notNull(),
    handledBy: integer("handledBy"),
    handledAt: timestamp("handledAt", withTimezone),
  },
  table => ({
    memberIdx: index("gym_renewal_member_idx").on(table.memberId),
    statusIdx: index("gym_renewal_status_idx").on(
      table.status,
      table.requestedAt
    ),
  })
);

export const workouts = pgTable(
  "gym_workouts",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    trainerId: integer("trainerId").notNull(),
    workoutDate: varchar("workoutDate", { length: 10 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    exercises: text("exercises"),
    dietNotes: text("dietNotes"),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    memberDateIdx: index("gym_workouts_member_date_idx").on(
      table.memberId,
      table.workoutDate
    ),
  })
);

export const progressEntries = pgTable(
  "gym_progress",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    trainerId: integer("trainerId").notNull(),
    entryDate: varchar("entryDate", { length: 10 }).notNull(),
    weightKg: numeric("weightKg", { precision: 5, scale: 1 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    memberDateIdx: index("gym_progress_member_date_idx").on(
      table.memberId,
      table.entryDate
    ),
  })
);

export const expenses = pgTable(
  "gym_expenses",
  {
    id: serial("id").primaryKey(),
    expenseDate: varchar("expenseDate", { length: 10 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    amount: integer("amount").notNull(),
    description: varchar("description", { length: 500 }),
    enteredBy: integer("enteredBy").notNull(),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  },
  table => ({ dateIdx: index("gym_expenses_date_idx").on(table.expenseDate) })
);

export const followUps = pgTable(
  "gym_follow_ups",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    trigger: followUpTrigger("trigger").notNull(),
    status: followUpStatus("status").default("pending").notNull(),
    notes: varchar("notes", { length: 1000 }),
    assignedTo: integer("assignedTo"),
    updatedBy: integer("updatedBy").notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    memberTriggerUnique: uniqueIndex("gym_followup_member_trigger_unique").on(
      table.memberId,
      table.trigger
    ),
  })
);

export const staffInvites = pgTable("gym_staff_invites", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 160 }),
  role: inviteRole("role").notNull(),
  linkedMemberId: integer("linkedMemberId"),
  active: boolean("active").default(true).notNull(),
  acceptedAt: timestamp("acceptedAt", withTimezone),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
});

// Email + password sign-in for self-hosted installs (AUTH_MODE=local). The role still
// comes from users/staffInvites; this table only proves who is signing in.
export const loginCredentials = pgTable("gym_login_credentials", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  failedAttempts: integer("failedAttempts").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil", withTimezone),
  // Sessions issued before this moment are rejected, so a reset signs out old devices.
  passwordChangedAt: timestamp("passwordChangedAt", withTimezone)
    .defaultNow()
    .notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
});

export const gymSettings = pgTable("gym_settings", {
  id: serial("id").primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }),
  gymName: varchar("gymName", { length: 160 })
    .default("DRK Fitness Gym")
    .notNull(),
  logoUrl: text("logoUrl"),
  address: varchar("address", { length: 500 }),
  contactPhone: varchar("contactPhone", { length: 32 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  businessDetails: varchar("businessDetails", { length: 500 }),
  currency: varchar("currency", { length: 3 }).default("INR").notNull(),
  timeZone: varchar("timeZone", { length: 64 })
    .default("Asia/Kolkata")
    .notNull(),
  expiryAlertDays: integer("expiryAlertDays").default(7).notNull(),
  inactiveVisitDays: integer("inactiveVisitDays").default(14).notNull(),
  planDefaults: text("planDefaults"),
  updatedBy: integer("updatedBy"),
  updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
});

export const auditLogs = pgTable(
  "gym_audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actorId").notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: integer("entityId"),
    reason: varchar("reason", { length: 1000 }),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    entityIdx: index("gym_audit_entity_idx").on(
      table.entityType,
      table.entityId
    ),
  })
);

// ---------------------------------------------------------------- fingerprint machine
// eSSL / ZKTeco machines over ADMS (PUSH protocol). See docs/BIOMETRIC.md.

/** A member's User ID (PIN) on the fingerprint machine, plus the owner's access override. */
export const biometricMembers = pgTable("gym_biometric_members", {
  memberId: integer("memberId").primaryKey(),
  pin: integer("pin").notNull().unique(),
  override: accessOverride("override"),
  createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
});

export const devices = pgTable("gym_devices", {
  sn: varchar("sn", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 80 }).default("Entrance").notNull(),
  status: deviceStatus("status").default("pending").notNull(),
  lastSeenAt: timestamp("lastSeenAt", withTimezone),
  lastIp: varchar("lastIp", { length: 64 }),
  pushVersion: varchar("pushVersion", { length: 32 }),
  info: text("info"),
  attStamp: varchar("attStamp", { length: 32 }),
  opStamp: varchar("opStamp", { length: 32 }),
  createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
});

export const deviceCommands = pgTable(
  "gym_device_commands",
  {
    id: serial("id").primaryKey(),
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    command: text("command").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    memberId: integer("memberId"),
    status: deviceCommandStatus("status").default("queued").notNull(),
    returnCode: integer("returnCode"),
    attempts: integer("attempts").default(0).notNull(),
    notBefore: timestamp("notBefore", withTimezone),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    sentAt: timestamp("sentAt", withTimezone),
    doneAt: timestamp("doneAt", withTimezone),
  },
  table => ({
    queueIdx: index("gym_device_commands_queue_idx").on(
      table.deviceSn,
      table.status,
      table.id
    ),
    memberIdx: index("gym_device_commands_member_idx").on(table.memberId),
  })
);

/** What each machine reports it holds; card/password are kept so updates never wipe them. */
export const deviceUsers = pgTable(
  "gym_device_users",
  {
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    pin: varchar("pin", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }),
    privilege: integer("privilege"),
    card: varchar("card", { length: 32 }),
    password: varchar("password", { length: 32 }),
    grp: varchar("grp", { length: 8 }),
    verify: varchar("verify", { length: 8 }),
    // Card and keypad password taken off during a block, put back on renewal.
    heldCard: varchar("heldCard", { length: 32 }),
    heldPassword: varchar("heldPassword", { length: 32 }),
    fingerprints: integer("fingerprints").default(0).notNull(),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.deviceSn, table.pin] }),
  })
);

/** Backup of every fingerprint the machine uploads, restored after a block ends. */
export const fingerprintTemplates = pgTable(
  "gym_fingerprint_templates",
  {
    pin: varchar("pin", { length: 32 }).notNull(),
    fid: integer("fid").notNull(),
    template: text("template").notNull(),
    size: integer("size"),
    valid: integer("valid"),
    sourceSn: varchar("sourceSn", { length: 64 }),
    updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({ pk: primaryKey({ columns: [table.pin, table.fid] }) })
);

/** What the software last told each machine for each member. */
export const memberDeviceState = pgTable(
  "gym_member_device_state",
  {
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    memberId: integer("memberId").notNull(),
    present: boolean("present").notNull(),
    allowed: boolean("allowed").notNull(),
    blockMode: varchar("blockMode", { length: 16 }),
    message: varchar("message", { length: 120 }),
    appliedAt: timestamp("appliedAt", withTimezone).defaultNow().notNull(),
  },
  table => ({ pk: primaryKey({ columns: [table.deviceSn, table.memberId] }) })
);

/** Every punch the machine sends (allowed, blocked or unknown), for the gate screen. */
export const biometricPunches = pgTable(
  "gym_biometric_punches",
  {
    id: serial("id").primaryKey(),
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    pin: varchar("pin", { length: 32 }).notNull(),
    memberId: integer("memberId"),
    punchedAt: timestamp("punchedAt", withTimezone).notNull(),
    punchDate: varchar("punchDate", { length: 10 }).notNull(),
    verifyType: integer("verifyType"),
    punchState: integer("punchState"),
    allowed: boolean("allowed"),
    reason: varchar("reason", { length: 32 }),
    headline: varchar("headline", { length: 160 }),
    duplicate: boolean("duplicate").default(false).notNull(),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
  },
  table => ({
    uniquePunch: uniqueIndex("gym_biometric_punches_unique").on(
      table.deviceSn,
      table.pin,
      table.punchedAt
    ),
    dayIdx: index("gym_biometric_punches_day_idx").on(table.punchDate),
  })
);

/** WhatsApp messages for members, created once per dedupe key. */
export const memberAlerts = pgTable(
  "gym_member_alerts",
  {
    id: serial("id").primaryKey(),
    memberId: integer("memberId").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    message: text("message").notNull(),
    status: alertStatus("status").default("pending").notNull(),
    error: varchar("error", { length: 300 }),
    createdAt: timestamp("createdAt", withTimezone).defaultNow().notNull(),
    sentAt: timestamp("sentAt", withTimezone),
    sentBy: integer("sentBy"),
  },
  table => ({
    once: uniqueIndex("gym_member_alerts_once").on(
      table.memberId,
      table.kind,
      table.dedupeKey
    ),
    statusIdx: index("gym_member_alerts_status_idx").on(table.status),
  })
);

/** Recent raw traffic from the machines, for troubleshooting the connection. */
export const deviceLog = pgTable(
  "gym_device_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", withTimezone).defaultNow().notNull(),
    deviceSn: varchar("deviceSn", { length: 64 }),
    method: varchar("method", { length: 8 }),
    path: varchar("path", { length: 120 }),
    query: varchar("query", { length: 500 }),
    body: text("body"),
    response: text("response"),
  },
  table => ({ atIdx: index("gym_device_log_at_idx").on(table.at) })
);

/** Fingerprint-machine and alert settings (one row, JSON), plus the daily-job marker. */
export const biometricConfig = pgTable("gym_biometric_config", {
  id: integer("id").primaryKey(),
  value: text("value").notNull(),
  lastDailyRun: varchar("lastDailyRun", { length: 10 }),
  updatedAt: timestamp("updatedAt", withTimezone).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type GymMember = typeof members.$inferSelect;
export type GymPlan = typeof plans.$inferSelect;
