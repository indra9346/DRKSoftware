CREATE TABLE `gym_attendance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`checkInDate` varchar(10) NOT NULL,
	`checkedInAt` timestamp NOT NULL DEFAULT (now()),
	`method` enum('qr','manual') NOT NULL DEFAULT 'manual',
	`staffId` int NOT NULL,
	CONSTRAINT `gym_attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_attendance_member_day_unique` UNIQUE(`memberId`,`checkInDate`)
);
--> statement-breakpoint
CREATE TABLE `gym_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` int,
	`reason` varchar(1000),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`expenseDate` varchar(10) NOT NULL,
	`category` varchar(100) NOT NULL,
	`amount` int NOT NULL,
	`description` varchar(500),
	`enteredBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_follow_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`trigger` enum('expiring','inactive') NOT NULL,
	`status` enum('pending','contacted','follow_up') NOT NULL DEFAULT 'pending',
	`notes` varchar(1000),
	`assignedTo` int,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_follow_ups_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_followup_member_trigger_unique` UNIQUE(`memberId`,`trigger`)
);
--> statement-breakpoint
CREATE TABLE `gym_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gymName` varchar(160) NOT NULL DEFAULT 'Swan Gym',
	`logoUrl` text,
	`address` varchar(500),
	`contactPhone` varchar(32),
	`contactEmail` varchar(320),
	`businessDetails` varchar(500),
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`timeZone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`expiryAlertDays` int NOT NULL DEFAULT 7,
	`inactiveVisitDays` int NOT NULL DEFAULT 14,
	`planDefaults` text,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberCode` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`email` varchar(320),
	`dateOfBirth` varchar(10),
	`emergencyContact` varchar(160),
	`joiningDate` varchar(10) NOT NULL,
	`fitnessGoal` text,
	`heightCm` decimal(5,1),
	`photoUrl` text,
	`status` enum('active','inactive','frozen') NOT NULL DEFAULT 'active',
	`trainerId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_members_memberCode_unique` UNIQUE(`memberCode`)
);
--> statement-breakpoint
CREATE TABLE `gym_membership_freezes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`membershipId` int NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`endDate` varchar(10),
	`reason` varchar(500) NOT NULL,
	`extensionDays` int NOT NULL DEFAULT 0,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_membership_freezes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`planId` int NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`endDate` varchar(10) NOT NULL,
	`planName` varchar(120) NOT NULL,
	`planPrice` int NOT NULL,
	`discount` int NOT NULL DEFAULT 0,
	`status` enum('active','expired','frozen','cancelled') NOT NULL DEFAULT 'active',
	`adminOverride` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_memberships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receiptNumber` varchar(32) NOT NULL,
	`memberId` int NOT NULL,
	`membershipId` int,
	`amount` int NOT NULL,
	`mode` enum('cash','upi','bank') NOT NULL,
	`notes` varchar(500),
	`status` enum('posted','reversed') NOT NULL DEFAULT 'posted',
	`correctionReason` varchar(500),
	`correctedBy` int,
	`correctedAt` timestamp,
	`recordedBy` int NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_payments_receiptNumber_unique` UNIQUE(`receiptNumber`)
);
--> statement-breakpoint
CREATE TABLE `gym_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`period` enum('monthly','quarterly','half_yearly','yearly','custom') NOT NULL DEFAULT 'monthly',
	`durationDays` int NOT NULL,
	`price` int NOT NULL,
	`description` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`trainerId` int NOT NULL,
	`entryDate` varchar(10) NOT NULL,
	`weightKg` decimal(5,1) NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_progress_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_receipt_counters` (
	`period` varchar(6) NOT NULL,
	`lastNumber` int NOT NULL,
	CONSTRAINT `gym_receipt_counters_period` PRIMARY KEY(`period`)
);
--> statement-breakpoint
CREATE TABLE `gym_staff_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(160),
	`role` enum('receptionist','trainer','member') NOT NULL,
	`linkedMemberId` int,
	`active` boolean NOT NULL DEFAULT true,
	`acceptedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_staff_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_staff_invites_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `gym_workouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`trainerId` int NOT NULL,
	`workoutDate` varchar(10) NOT NULL,
	`title` varchar(160) NOT NULL,
	`exercises` text,
	`dietNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_workouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','owner','receptionist','trainer','member') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `linkedMemberId` int;--> statement-breakpoint
CREATE INDEX `gym_attendance_day_idx` ON `gym_attendance` (`checkInDate`);--> statement-breakpoint
CREATE INDEX `gym_audit_entity_idx` ON `gym_audit_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `gym_expenses_date_idx` ON `gym_expenses` (`expenseDate`);--> statement-breakpoint
CREATE INDEX `gym_members_phone_idx` ON `gym_members` (`phone`);--> statement-breakpoint
CREATE INDEX `gym_members_name_idx` ON `gym_members` (`name`);--> statement-breakpoint
CREATE INDEX `gym_freezes_membership_idx` ON `gym_membership_freezes` (`membershipId`);--> statement-breakpoint
CREATE INDEX `gym_memberships_member_idx` ON `gym_memberships` (`memberId`);--> statement-breakpoint
CREATE INDEX `gym_memberships_validity_idx` ON `gym_memberships` (`status`,`endDate`);--> statement-breakpoint
CREATE INDEX `gym_payments_member_idx` ON `gym_payments` (`memberId`);--> statement-breakpoint
CREATE INDEX `gym_payments_timestamp_idx` ON `gym_payments` (`recordedAt`);--> statement-breakpoint
CREATE INDEX `gym_progress_member_date_idx` ON `gym_progress` (`memberId`,`entryDate`);--> statement-breakpoint
CREATE INDEX `gym_workouts_member_date_idx` ON `gym_workouts` (`memberId`,`workoutDate`);