DROP TRIGGER IF EXISTS payments_receipt_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS receipts_immutable;
--> statement-breakpoint
CREATE TRIGGER payments_receipt_update BEFORE UPDATE ON payments WHEN OLD.receipt_id IS NOT NULL AND (NEW.id IS NOT OLD.id OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.amount IS NOT OLD.amount OR NEW.date IS NOT OLD.date OR NEW.note IS NOT OLD.note OR NEW.settlement_id IS NOT OLD.settlement_id OR NEW.ad_invoice_id IS NOT OLD.ad_invoice_id OR NEW.brand_id IS NOT OLD.brand_id) BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER receipts_immutable BEFORE UPDATE ON payment_receipts WHEN NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.brand_id IS NOT OLD.brand_id OR NEW.date IS NOT OLD.date OR NEW.request_hash IS NOT OLD.request_hash OR NEW.data IS NOT OLD.data OR NEW.total IS NOT OLD.total OR NEW.created_at IS NOT OLD.created_at OR (OLD.reversed_at IS NOT NULL AND (NEW.reversed_at IS NOT OLD.reversed_at OR NEW.reversal_reason IS NOT OLD.reversal_reason)) BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
