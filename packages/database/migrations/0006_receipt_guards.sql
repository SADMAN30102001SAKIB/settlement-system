CREATE TRIGGER settlements_payment_version_insert AFTER INSERT ON settlements BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (NEW.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER settlements_payment_version_update AFTER UPDATE ON settlements BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id, NEW.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER settlements_payment_version_delete AFTER DELETE ON settlements BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER settlements_receipt_delete BEFORE DELETE ON settlements WHEN EXISTS (SELECT 1 FROM receipt_lines WHERE settlement_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_REFERENCED'); END;
--> statement-breakpoint
CREATE TRIGGER settlements_receipt_update BEFORE UPDATE ON settlements WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id = l.receipt_id WHERE l.settlement_id = OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_payment_version_insert AFTER INSERT ON ad_invoices BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (NEW.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_payment_version_update AFTER UPDATE ON ad_invoices BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id, NEW.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_payment_version_delete AFTER DELETE ON ad_invoices BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_receipt_delete BEFORE DELETE ON ad_invoices WHEN EXISTS (SELECT 1 FROM receipt_lines WHERE ad_invoice_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_REFERENCED'); END;
--> statement-breakpoint
CREATE TRIGGER ad_invoices_receipt_update BEFORE UPDATE ON ad_invoices WHEN EXISTS (SELECT 1 FROM receipt_lines l JOIN payment_receipts r ON r.id = l.receipt_id WHERE l.ad_invoice_id = OLD.id AND r.reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'PAYMENT_RECEIPT_ACTIVE'); END;
--> statement-breakpoint
CREATE TRIGGER payments_version_insert AFTER INSERT ON payments BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (NEW.brand_id, (SELECT brand_id FROM settlements WHERE id = NEW.settlement_id), (SELECT brand_id FROM ad_invoices WHERE id = NEW.ad_invoice_id)); END;
--> statement-breakpoint
CREATE TRIGGER payments_version_update AFTER UPDATE ON payments BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id, (SELECT brand_id FROM settlements WHERE id = OLD.settlement_id), (SELECT brand_id FROM ad_invoices WHERE id = OLD.ad_invoice_id), NEW.brand_id, (SELECT brand_id FROM settlements WHERE id = NEW.settlement_id), (SELECT brand_id FROM ad_invoices WHERE id = NEW.ad_invoice_id)); END;
--> statement-breakpoint
CREATE TRIGGER payments_version_delete AFTER DELETE ON payments BEGIN UPDATE brands SET payment_version = payment_version + 1 WHERE id IN (OLD.brand_id, (SELECT brand_id FROM settlements WHERE id = OLD.settlement_id), (SELECT brand_id FROM ad_invoices WHERE id = OLD.ad_invoice_id)); END;
--> statement-breakpoint
CREATE TRIGGER payments_receipt_delete BEFORE DELETE ON payments WHEN OLD.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM payment_receipts WHERE id = OLD.receipt_id AND reversed_at IS NULL) BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER payments_receipt_update BEFORE UPDATE ON payments WHEN OLD.receipt_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
