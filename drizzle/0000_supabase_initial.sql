CREATE TYPE "public"."access_override" AS ENUM('allow', 'block');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."attendance_method" AS ENUM('qr', 'manual', 'biometric');--> statement-breakpoint
CREATE TYPE "public"."device_command_status" AS ENUM('queued', 'sent', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('pending', 'contacted', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."follow_up_trigger" AS ENUM('expiring', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."invite_role" AS ENUM('receptionist', 'trainer', 'member');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'inactive', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'expired', 'frozen', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'upi', 'bank');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."plan_period" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('pending', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'owner', 'receptionist', 'trainer', 'member');--> statement-breakpoint
CREATE TABLE "gym_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"checkInDate" varchar(10) NOT NULL,
	"checkedInAt" timestamp with time zone DEFAULT now() NOT NULL,
	"checkedOutAt" timestamp with time zone,
	"method" "attendance_method" DEFAULT 'manual' NOT NULL,
	"staffId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorId" integer NOT NULL,
	"action" varchar(80) NOT NULL,
	"entityType" varchar(80) NOT NULL,
	"entityId" integer,
	"reason" varchar(1000),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_biometric_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"lastDailyRun" varchar(10),
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_biometric_members" (
	"memberId" integer PRIMARY KEY NOT NULL,
	"pin" integer NOT NULL,
	"override" "access_override",
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_biometric_members_pin_unique" UNIQUE("pin")
);
--> statement-breakpoint
CREATE TABLE "gym_biometric_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"deviceSn" varchar(64) NOT NULL,
	"pin" varchar(32) NOT NULL,
	"memberId" integer,
	"punchedAt" timestamp with time zone NOT NULL,
	"punchDate" varchar(10) NOT NULL,
	"verifyType" integer,
	"punchState" integer,
	"allowed" boolean,
	"reason" varchar(32),
	"headline" varchar(160),
	"duplicate" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_device_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"deviceSn" varchar(64) NOT NULL,
	"command" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"memberId" integer,
	"status" "device_command_status" DEFAULT 'queued' NOT NULL,
	"returnCode" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"notBefore" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sentAt" timestamp with time zone,
	"doneAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gym_device_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"deviceSn" varchar(64),
	"method" varchar(8),
	"path" varchar(120),
	"query" varchar(500),
	"body" text,
	"response" text
);
--> statement-breakpoint
CREATE TABLE "gym_device_users" (
	"deviceSn" varchar(64) NOT NULL,
	"pin" varchar(32) NOT NULL,
	"name" varchar(80),
	"privilege" integer,
	"card" varchar(32),
	"password" varchar(32),
	"grp" varchar(8),
	"verify" varchar(8),
	"heldCard" varchar(32),
	"heldPassword" varchar(32),
	"fingerprints" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_device_users_deviceSn_pin_pk" PRIMARY KEY("deviceSn","pin")
);
--> statement-breakpoint
CREATE TABLE "gym_devices" (
	"sn" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(80) DEFAULT 'Entrance' NOT NULL,
	"status" "device_status" DEFAULT 'pending' NOT NULL,
	"lastSeenAt" timestamp with time zone,
	"lastIp" varchar(64),
	"pushVersion" varchar(32),
	"info" text,
	"attStamp" varchar(32),
	"opStamp" varchar(32),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expenseDate" varchar(10) NOT NULL,
	"category" varchar(100) NOT NULL,
	"amount" integer NOT NULL,
	"description" varchar(500),
	"enteredBy" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_fingerprint_templates" (
	"pin" varchar(32) NOT NULL,
	"fid" integer NOT NULL,
	"template" text NOT NULL,
	"size" integer,
	"valid" integer,
	"sourceSn" varchar(64),
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_fingerprint_templates_pin_fid_pk" PRIMARY KEY("pin","fid")
);
--> statement-breakpoint
CREATE TABLE "gym_follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"trigger" "follow_up_trigger" NOT NULL,
	"status" "follow_up_status" DEFAULT 'pending' NOT NULL,
	"notes" varchar(1000),
	"assignedTo" integer,
	"updatedBy" integer NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerOpenId" varchar(64),
	"gymName" varchar(160) DEFAULT 'DRK Fitness Gym' NOT NULL,
	"logoUrl" text,
	"address" varchar(500),
	"contactPhone" varchar(32),
	"contactEmail" varchar(320),
	"businessDetails" varchar(500),
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"timeZone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"expiryAlertDays" integer DEFAULT 7 NOT NULL,
	"inactiveVisitDays" integer DEFAULT 14 NOT NULL,
	"planDefaults" text,
	"updatedBy" integer,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_login_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"openId" varchar(64) NOT NULL,
	"passwordHash" varchar(255) NOT NULL,
	"failedAttempts" integer DEFAULT 0 NOT NULL,
	"lockedUntil" timestamp with time zone,
	"passwordChangedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_login_credentials_email_unique" UNIQUE("email"),
	CONSTRAINT "gym_login_credentials_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "gym_member_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"dedupeKey" varchar(80) NOT NULL,
	"phone" varchar(20),
	"message" text NOT NULL,
	"status" "alert_status" DEFAULT 'pending' NOT NULL,
	"error" varchar(300),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sentAt" timestamp with time zone,
	"sentBy" integer
);
--> statement-breakpoint
CREATE TABLE "gym_member_device_state" (
	"deviceSn" varchar(64) NOT NULL,
	"memberId" integer NOT NULL,
	"present" boolean NOT NULL,
	"allowed" boolean NOT NULL,
	"blockMode" varchar(16),
	"message" varchar(120),
	"appliedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_device_state_deviceSn_memberId_pk" PRIMARY KEY("deviceSn","memberId")
);
--> statement-breakpoint
CREATE TABLE "gym_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberCode" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"email" varchar(320),
	"dateOfBirth" varchar(10),
	"emergencyContact" varchar(160),
	"joiningDate" varchar(10) NOT NULL,
	"fitnessGoal" text,
	"heightCm" numeric(5, 1),
	"photoUrl" text,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"trainerId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_members_memberCode_unique" UNIQUE("memberCode")
);
--> statement-breakpoint
CREATE TABLE "gym_membership_freezes" (
	"id" serial PRIMARY KEY NOT NULL,
	"membershipId" integer NOT NULL,
	"startDate" varchar(10) NOT NULL,
	"endDate" varchar(10),
	"reason" varchar(500) NOT NULL,
	"extensionDays" integer DEFAULT 0 NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"planId" integer NOT NULL,
	"startDate" varchar(10) NOT NULL,
	"endDate" varchar(10) NOT NULL,
	"planName" varchar(120) NOT NULL,
	"planPrice" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"adminOverride" boolean DEFAULT false NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"receiptNumber" varchar(32) NOT NULL,
	"memberId" integer NOT NULL,
	"membershipId" integer,
	"amount" integer NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"notes" varchar(500),
	"status" "payment_status" DEFAULT 'posted' NOT NULL,
	"correctionReason" varchar(500),
	"correctedBy" integer,
	"correctedAt" timestamp with time zone,
	"recordedBy" integer NOT NULL,
	"recordedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_payments_receiptNumber_unique" UNIQUE("receiptNumber")
);
--> statement-breakpoint
CREATE TABLE "gym_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"period" "plan_period" DEFAULT 'monthly' NOT NULL,
	"durationDays" integer NOT NULL,
	"price" integer NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"trainerId" integer NOT NULL,
	"entryDate" varchar(10) NOT NULL,
	"weightKg" numeric(5, 1) NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_receipt_counters" (
	"period" varchar(6) PRIMARY KEY NOT NULL,
	"lastNumber" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_renewal_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"planId" integer NOT NULL,
	"status" "renewal_status" DEFAULT 'pending' NOT NULL,
	"requestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"handledBy" integer,
	"handledAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gym_staff_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(160),
	"role" "invite_role" NOT NULL,
	"linkedMemberId" integer,
	"active" boolean DEFAULT true NOT NULL,
	"acceptedAt" timestamp with time zone,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_staff_invites_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"linkedMemberId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "gym_workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"memberId" integer NOT NULL,
	"trainerId" integer NOT NULL,
	"workoutDate" varchar(10) NOT NULL,
	"title" varchar(160) NOT NULL,
	"exercises" text,
	"dietNotes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gym_attendance_member_day_unique" ON "gym_attendance" USING btree ("memberId","checkInDate");--> statement-breakpoint
CREATE INDEX "gym_attendance_day_idx" ON "gym_attendance" USING btree ("checkInDate");--> statement-breakpoint
CREATE INDEX "gym_audit_entity_idx" ON "gym_audit_logs" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_biometric_punches_unique" ON "gym_biometric_punches" USING btree ("deviceSn","pin","punchedAt");--> statement-breakpoint
CREATE INDEX "gym_biometric_punches_day_idx" ON "gym_biometric_punches" USING btree ("punchDate");--> statement-breakpoint
CREATE INDEX "gym_device_commands_queue_idx" ON "gym_device_commands" USING btree ("deviceSn","status","id");--> statement-breakpoint
CREATE INDEX "gym_device_commands_member_idx" ON "gym_device_commands" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "gym_device_log_at_idx" ON "gym_device_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "gym_expenses_date_idx" ON "gym_expenses" USING btree ("expenseDate");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_followup_member_trigger_unique" ON "gym_follow_ups" USING btree ("memberId","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_member_alerts_once" ON "gym_member_alerts" USING btree ("memberId","kind","dedupeKey");--> statement-breakpoint
CREATE INDEX "gym_member_alerts_status_idx" ON "gym_member_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gym_members_phone_idx" ON "gym_members" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "gym_members_name_idx" ON "gym_members" USING btree ("name");--> statement-breakpoint
CREATE INDEX "gym_freezes_membership_idx" ON "gym_membership_freezes" USING btree ("membershipId");--> statement-breakpoint
CREATE INDEX "gym_memberships_member_idx" ON "gym_memberships" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "gym_memberships_validity_idx" ON "gym_memberships" USING btree ("status","endDate");--> statement-breakpoint
CREATE INDEX "gym_payments_member_idx" ON "gym_payments" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "gym_payments_membership_idx" ON "gym_payments" USING btree ("membershipId");--> statement-breakpoint
CREATE INDEX "gym_payments_timestamp_idx" ON "gym_payments" USING btree ("recordedAt");--> statement-breakpoint
CREATE INDEX "gym_progress_member_date_idx" ON "gym_progress" USING btree ("memberId","entryDate");--> statement-breakpoint
CREATE INDEX "gym_renewal_member_idx" ON "gym_renewal_requests" USING btree ("memberId");--> statement-breakpoint
CREATE INDEX "gym_renewal_status_idx" ON "gym_renewal_requests" USING btree ("status","requestedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "users_linked_member_id_unique" ON "users" USING btree ("linkedMemberId");--> statement-breakpoint
CREATE INDEX "gym_workouts_member_date_idx" ON "gym_workouts" USING btree ("memberId","workoutDate");