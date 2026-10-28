DROP TRIGGER receipt_lines_immutable_delete;
--> statement-breakpoint
CREATE TRIGGER receipt_lines_immutable_delete BEFORE DELETE ON receipt_lines WHEN NOT EXISTS (SELECT 1 FROM payment_receipts r JOIN deleted_receipt_requests d ON d.id=r.id WHERE r.id=OLD.receipt_id AND r.reversed_at IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'RECEIPT_PAYMENT_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER receipts_delete_reversed BEFORE DELETE ON payment_receipts BEGIN
  SELECT CASE WHEN OLD.reversed_at IS NULL OR EXISTS (SELECT 1 FROM payments WHERE receipt_id=OLD.id) THEN RAISE(ABORT, 'RECEIPT_DELETE_BLOCKED') END;
  INSERT INTO deleted_receipt_requests (id,deleted_at) VALUES (OLD.id,CAST(strftime('%s','now') AS INTEGER)*1000);
  DELETE FROM receipt_lines WHERE receipt_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER receipts_no_recreate BEFORE INSERT ON payment_receipts WHEN EXISTS (SELECT 1 FROM deleted_receipt_requests WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT, 'RECEIPT_DELETED'); END;
