CREATE TABLE `invoice_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text,
	`ad_invoice_id` text,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_invoice_id`) REFERENCES `ad_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_status_one_target" CHECK(("invoice_statuses"."settlement_id" IS NOT NULL) + ("invoice_statuses"."ad_invoice_id" IS NOT NULL) = 1),
	CONSTRAINT "invoice_status_valid" CHECK("invoice_statuses"."status" IN ('Unpaid','Paid','Due','Advance','N/A'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_statuses_settlement_id_unique` ON `invoice_statuses` (`settlement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_statuses_ad_invoice_id_unique` ON `invoice_statuses` (`ad_invoice_id`);--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `stamp_status` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `paid_stamp_file_id` text REFERENCES files(id);--> statement-breakpoint
ALTER TABLE `settings` ADD `unpaid_stamp_file_id` text REFERENCES files(id);--> statement-breakpoint
ALTER TABLE `settings` ADD `due_stamp_file_id` text REFERENCES files(id);