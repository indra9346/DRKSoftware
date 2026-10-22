CREATE TABLE `gym_renewal_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`memberId` int NOT NULL,
	`planId` int NOT NULL,
	`status` enum('pending','fulfilled','cancelled') NOT NULL DEFAULT 'pending',
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`handledBy` int,
	`handledAt` timestamp,
	CONSTRAINT `gym_renewal_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `gym_attendance` ADD `checkedOutAt` timestamp;--> statement-breakpoint
CREATE INDEX `gym_renewal_member_idx` ON `gym_renewal_requests` (`memberId`);--> statement-breakpoint
CREATE INDEX `gym_renewal_status_idx` ON `gym_renewal_requests` (`status`,`requestedAt`);