CREATE TABLE `daily_tasks` (
	`date` text NOT NULL,
	`brand_id` text NOT NULL,
	`orders_done` integer DEFAULT false NOT NULL,
	`ads_done` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `brand_id`),
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_tasks_revision_positive" CHECK("daily_tasks"."revision" > 0),
	CONSTRAINT "daily_tasks_orders_boolean" CHECK("daily_tasks"."orders_done" IN (0,1)),
	CONSTRAINT "daily_tasks_ads_boolean" CHECK("daily_tasks"."ads_done" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `daily_tasks_brand_idx` ON `daily_tasks` (`brand_id`);