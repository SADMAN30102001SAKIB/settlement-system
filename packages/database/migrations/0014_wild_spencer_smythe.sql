CREATE TABLE `brand_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brand_users`(`brand_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `brand_sessions_expiry_idx` ON `brand_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `brand_sessions_brand_idx` ON `brand_sessions` (`brand_id`);--> statement-breakpoint
CREATE TABLE `brand_users` (
	`brand_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_users_username_unique` ON `brand_users` (`username`);--> statement-breakpoint
ALTER TABLE `admins` ADD `auth_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_version` integer DEFAULT 0 NOT NULL;