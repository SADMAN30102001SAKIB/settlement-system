CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`brand_id` text NOT NULL,
	`date` text NOT NULL,
	`request_hash` text NOT NULL,
	`data` text NOT NULL,
	`total` integer NOT NULL,
	`proof_file_id` text,
	`created_at` integer NOT NULL,
	`reversed_at` integer,
	`reversal_reason` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`proof_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "receipts_total_positive" CHECK("payment_receipts"."total" > 0),
	CONSTRAINT "receipts_reversal_valid" CHECK("payment_receipts"."reversed_at" IS NULL OR ("payment_receipts"."reversed_at" >= 0 AND length("payment_receipts"."reversal_reason") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipts_number_unique` ON `payment_receipts` (`number`);--> statement-breakpoint
CREATE INDEX `receipts_brand_date_idx` ON `payment_receipts` (`brand_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `receipts_date_idx` ON `payment_receipts` (`date`,`id`);--> statement-breakpoint
CREATE TABLE `receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`settlement_id` text,
	`ad_invoice_id` text,
	`payment_id` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ad_invoice_id`) REFERENCES `ad_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipt_lines_one_invoice" CHECK(("receipt_lines"."settlement_id" IS NOT NULL) + ("receipt_lines"."ad_invoice_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_lines_payment_id_unique` ON `receipt_lines` (`payment_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt_idx` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_settlement_idx` ON `receipt_lines` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_ads_idx` ON `receipt_lines` (`ad_invoice_id`);--> statement-breakpoint
ALTER TABLE `brands` ADD `payment_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_id` text REFERENCES payment_receipts(id);--> statement-breakpoint
CREATE INDEX `payments_receipt_idx` ON `payments` (`receipt_id`);