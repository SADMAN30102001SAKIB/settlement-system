-- Keep the table rebuild and replacement guards in one atomic migration.
DROP TRIGGER settlements_receipt_delete;--> statement-breakpoint
DROP TRIGGER settlements_receipt_update;--> statement-breakpoint
DROP TRIGGER ad_invoices_receipt_delete;--> statement-breakpoint
DROP TRIGGER ad_invoices_receipt_update;--> statement-breakpoint
CREATE TABLE `__new_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`settlement_id` text,
	`ad_invoice_id` text,
	`payment_id` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipt_lines_one_invoice" CHECK(("__new_receipt_lines"."settlement_id" IS NOT NULL) + ("__new_receipt_lines"."ad_invoice_id" IS NOT NULL) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_receipt_lines`("id", "receipt_id", "settlement_id", "ad_invoice_id", "payment_id") SELECT "id", "receipt_id", "settlement_id", "ad_invoice_id", "payment_id" FROM `receipt_lines`;--> statement-breakpoint
DROP TABLE `receipt_lines`;--> statement-breakpoint
ALTER TABLE `__new_receipt_lines` RENAME TO `receipt_lines`;--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_lines_payment_id_unique` ON `receipt_lines` (`payment_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_receipt_idx` ON `receipt_lines` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_settlement_idx` ON `receipt_lines` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `receipt_lines_ads_idx` ON `receipt_lines` (`ad_invoice_id`);
--> statement-breakpoint
CREATE TRIGGER settlements_receipt_delete BEFORE DELETE ON settlements WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id=l.receipt_id WHERE l.settlement_id=OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER settlements_receipt_update BEFORE UPDATE ON settlements WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id=l.receipt_id WHERE l.settlement_id=OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_receipt_delete BEFORE DELETE ON ad_invoices WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id=l.receipt_id WHERE l.ad_invoice_id=OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_receipt_update BEFORE UPDATE ON ad_invoices WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id=l.receipt_id WHERE l.ad_invoice_id=OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_lines_valid_insert BEFORE INSERT ON receipt_lines WHEN NOT EXISTS (SELECT 1 FROM payment_receipts WHERE id=NEW.receipt_id AND reversed_at IS NULL) OR (NEW.settlement_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM settlements s JOIN payment_receipts r ON r.brand_id=s.brand_id WHERE s.id=NEW.settlement_id AND r.id=NEW.receipt_id)) OR (NEW.ad_invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_invoices a JOIN payment_receipts r ON r.brand_id=a.brand_id WHERE a.id=NEW.ad_invoice_id AND r.id=NEW.receipt_id)) BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_lines_immutable_update BEFORE UPDATE ON receipt_lines BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_lines_immutable_delete BEFORE DELETE ON receipt_lines BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
