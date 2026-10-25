CREATE TABLE `gym_biometric_config` (
	`id` int NOT NULL,
	`value` text NOT NULL,
	`lastDailyRun` varchar(10),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_biometric_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_biometric_members` (
	`memberId` int NOT NULL,
	`pin` int NOT NULL,
	`override` enum('allow','block'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_biometric_members_memberId` PRIMARY KEY(`memberId`),
	CONSTRAINT `gym_biometric_members_pin_unique` UNIQUE(`pin`)
);
--> statement-breakpoint
CREATE TABLE `gym_biometric_punches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deviceSn` varchar(64) NOT NULL,
	`pin` varchar(32) NOT NULL,
	`memberId` int,
	`punchedAt` timestamp NOT NULL,
	`punchDate` varchar(10) NOT NULL,
	`verifyType` int,
	`punchState` int,
	`allowed` boolean,
	`reason` varchar(32),
	`headline` varchar(160),
	`duplicate` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_biometric_punches_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_biometric_punches_unique` UNIQUE(`deviceSn`,`pin`,`punchedAt`)
);
--> statement-breakpoint
CREATE TABLE `gym_device_commands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deviceSn` varchar(64) NOT NULL,
	`command` mediumtext NOT NULL,
	`kind` varchar(32) NOT NULL,
	`memberId` int,
	`status` enum('queued','sent','done','failed','cancelled') NOT NULL DEFAULT 'queued',
	`returnCode` int,
	`attempts` int NOT NULL DEFAULT 0,
	`notBefore` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	`doneAt` timestamp,
	CONSTRAINT `gym_device_commands_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_device_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`at` timestamp NOT NULL DEFAULT (now()),
	`deviceSn` varchar(64),
	`method` varchar(8),
	`path` varchar(120),
	`query` varchar(500),
	`body` text,
	`response` text,
	CONSTRAINT `gym_device_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_device_users` (
	`deviceSn` varchar(64) NOT NULL,
	`pin` varchar(32) NOT NULL,
	`name` varchar(80),
	`privilege` int,
	`card` varchar(32),
	`password` varchar(32),
	`grp` varchar(8),
	`verify` varchar(8),
	`heldCard` varchar(32),
	`heldPassword` varchar(32),
	`fingerprints` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_device_users_deviceSn_pin_pk` PRIMARY KEY(`deviceSn`,`pin`)
);
--> statement-breakpoint
CREATE TABLE `gym_devices` (
	`sn` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL DEFAULT 'Entrance',
	`status` enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
	`lastSeenAt` timestamp,
	`lastIp` varchar(64),
	`pushVersion` varchar(32),
	`info` text,
	`attStamp` varchar(32),
	`opStamp` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_devices_sn` PRIMARY KEY(`sn`)
);
--> statement-breakpoint
CREATE TABLE `gym_fingerprint_templates` (
	`pin` varchar(32) NOT NULL,
	`fid` int NOT NULL,
	`template` mediumtext NOT NULL,
	`size` int,
	`valid` int,
	`sourceSn` varchar(64),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gym_fingerprint_templates_pin_fid_pk` PRIMARY KEY(`pin`,`fid`)
);
--> statement-breakpoint
CREATE TABLE `gym_member_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`kind` varchar(32) NOT NULL,
	`dedupeKey` varchar(80) NOT NULL,
	`phone` varchar(20),
	`message` text NOT NULL,
	`status` enum('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
	`error` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	`sentBy` int,
	CONSTRAINT `gym_member_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `gym_member_alerts_once` UNIQUE(`memberId`,`kind`,`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `gym_member_device_state` (
	`deviceSn` varchar(64) NOT NULL,
	`memberId` int NOT NULL,
	`present` boolean NOT NULL,
	`allowed` boolean NOT NULL,
	`blockMode` varchar(16),
	`message` varchar(120),
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_member_device_state_deviceSn_memberId_pk` PRIMARY KEY(`deviceSn`,`memberId`)
);
--> statement-breakpoint
ALTER TABLE `gym_attendance` MODIFY COLUMN `method` enum('qr','manual','biometric') NOT NULL DEFAULT 'manual';--> statement-breakpoint
CREATE INDEX `gym_biometric_punches_day_idx` ON `gym_biometric_punches` (`punchDate`);--> statement-breakpoint
CREATE INDEX `gym_device_commands_queue_idx` ON `gym_device_commands` (`deviceSn`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `gym_device_commands_member_idx` ON `gym_device_commands` (`memberId`);--> statement-breakpoint
CREATE INDEX `gym_device_log_at_idx` ON `gym_device_log` (`at`);--> statement-breakpoint
CREATE INDEX `gym_member_alerts_status_idx` ON `gym_member_alerts` (`status`);