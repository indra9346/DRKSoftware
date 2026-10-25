import {
  boolean,
  decimal,
  index,
  int,
  primaryKey,
  mediumtext,
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
    // biometric = recorded by the fingerprint machine at the entrance (staffId 0).
    method: mysqlEnum("method", ["qr", "manual", "biometric"])
      .default("manual")
      .notNull(),
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

// ---------------------------------------------------------------- fingerprint machine
// eSSL / ZKTeco machines over ADMS (PUSH protocol). See docs/BIOMETRIC.md.

/** A member's User ID (PIN) on the fingerprint machine, plus the owner's access override. */
export const biometricMembers = mysqlTable("gym_biometric_members", {
  memberId: int("memberId").primaryKey(),
  pin: int("pin").notNull().unique(),
  override: mysqlEnum("override", ["allow", "block"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const devices = mysqlTable("gym_devices", {
  sn: varchar("sn", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 80 }).default("Entrance").notNull(),
  status: mysqlEnum("status", ["pending", "active", "disabled"])
    .default("pending")
    .notNull(),
  lastSeenAt: timestamp("lastSeenAt"),
  lastIp: varchar("lastIp", { length: 64 }),
  pushVersion: varchar("pushVersion", { length: 32 }),
  info: text("info"),
  attStamp: varchar("attStamp", { length: 32 }),
  opStamp: varchar("opStamp", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const deviceCommands = mysqlTable(
  "gym_device_commands",
  {
    id: int("id").autoincrement().primaryKey(),
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    command: mediumtext("command").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    memberId: int("memberId"),
    status: mysqlEnum("status", [
      "queued",
      "sent",
      "done",
      "failed",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    returnCode: int("returnCode"),
    attempts: int("attempts").default(0).notNull(),
    notBefore: timestamp("notBefore"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    sentAt: timestamp("sentAt"),
    doneAt: timestamp("doneAt"),
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
export const deviceUsers = mysqlTable(
  "gym_device_users",
  {
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    pin: varchar("pin", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }),
    privilege: int("privilege"),
    card: varchar("card", { length: 32 }),
    password: varchar("password", { length: 32 }),
    grp: varchar("grp", { length: 8 }),
    verify: varchar("verify", { length: 8 }),
    // Card and keypad password taken off during a block, put back on renewal.
    heldCard: varchar("heldCard", { length: 32 }),
    heldPassword: varchar("heldPassword", { length: 32 }),
    fingerprints: int("fingerprints").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.deviceSn, table.pin] }),
  })
);

/** Backup of every fingerprint the machine uploads, restored after a block ends. */
export const fingerprintTemplates = mysqlTable(
  "gym_fingerprint_templates",
  {
    pin: varchar("pin", { length: 32 }).notNull(),
    fid: int("fid").notNull(),
    template: mediumtext("template").notNull(),
    size: int("size"),
    valid: int("valid"),
    sourceSn: varchar("sourceSn", { length: 64 }),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ pk: primaryKey({ columns: [table.pin, table.fid] }) })
);

/** What the software last told each machine for each member. */
export const memberDeviceState = mysqlTable(
  "gym_member_device_state",
  {
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    memberId: int("memberId").notNull(),
    present: boolean("present").notNull(),
    allowed: boolean("allowed").notNull(),
    blockMode: varchar("blockMode", { length: 16 }),
    message: varchar("message", { length: 120 }),
    appliedAt: timestamp("appliedAt").defaultNow().notNull(),
  },
  table => ({ pk: primaryKey({ columns: [table.deviceSn, table.memberId] }) })
);

/** Every punch the machine sends (allowed, blocked or unknown), for the gate screen. */
export const biometricPunches = mysqlTable(
  "gym_biometric_punches",
  {
    id: int("id").autoincrement().primaryKey(),
    deviceSn: varchar("deviceSn", { length: 64 }).notNull(),
    pin: varchar("pin", { length: 32 }).notNull(),
    memberId: int("memberId"),
    punchedAt: timestamp("punchedAt").notNull(),
    punchDate: varchar("punchDate", { length: 10 }).notNull(),
    verifyType: int("verifyType"),
    punchState: int("punchState"),
    allowed: boolean("allowed"),
    reason: varchar("reason", { length: 32 }),
    headline: varchar("headline", { length: 160 }),
    duplicate: boolean("duplicate").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const memberAlerts = mysqlTable(
  "gym_member_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: int("memberId").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    message: text("message").notNull(),
    status: mysqlEnum("status", ["pending", "sent", "failed", "skipped"])
      .default("pending")
      .notNull(),
    error: varchar("error", { length: 300 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    sentAt: timestamp("sentAt"),
    sentBy: int("sentBy"),
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
export const deviceLog = mysqlTable(
  "gym_device_log",
  {
    id: int("id").autoincrement().primaryKey(),
    at: timestamp("at").defaultNow().notNull(),
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
export const biometricConfig = mysqlTable("gym_biometric_config", {
  id: int("id").primaryKey(),
  value: text("value").notNull(),
  lastDailyRun: varchar("lastDailyRun", { length: 10 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type GymMember = typeof members.$inferSelect;
export type GymPlan = typeof plans.$inferSelect;
