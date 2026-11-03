CREATE TABLE `brand_advances` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text NOT NULL,
	`note` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "advance_positive" CHECK("brand_advances"."amount">0 AND "brand_advances"."amount"%10=0),
	CONSTRAINT "advance_reversal_valid" CHECK("brand_advances"."reversed_at" IS NULL OR ("brand_advances"."reversed_at">=0 AND length("brand_advances"."reversal_reason")>=5))
);
--> statement-breakpoint
CREATE INDEX `brand_advances_date_idx` ON `brand_advances` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE TABLE `manual_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`recipient` text NOT NULL,
	`data` text NOT NULL,
	`total` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "manual_total_valid" CHECK("manual_invoices"."total">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_invoices_number_unique` ON `manual_invoices` (`number`);--> statement-breakpoint
CREATE INDEX `manual_invoices_date_idx` ON `manual_invoices` (`date`,`id`);--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `advance_amount` integer DEFAULT 0 NOT NULL;