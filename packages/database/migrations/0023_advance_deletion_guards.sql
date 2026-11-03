CREATE TRIGGER advance_delete_guard BEFORE DELETE ON brand_advances
WHEN OLD.reversed_at IS NULL BEGIN
  SELECT CASE WHEN OLD.amount >
    (SELECT COALESCE(SUM(amount),0) FROM brand_advances WHERE brand_id=OLD.brand_id AND reversed_at IS NULL)
    -(SELECT COALESCE(SUM(advance_amount),0) FROM payment_receipts WHERE brand_id=OLD.brand_id AND reversed_at IS NULL)
    THEN RAISE(ABORT,'ADVANCE_IN_USE') END;
END;
--> statement-breakpoint
CREATE TRIGGER advance_delete_history AFTER DELETE ON brand_advances BEGIN
  INSERT INTO deleted_advance_requests(id,deleted_at) VALUES (OLD.id,CAST(strftime('%s','now') AS INTEGER)*1000);
  UPDATE brands SET payment_version=payment_version+1 WHERE id=OLD.brand_id;
END;
--> statement-breakpoint
CREATE TRIGGER advance_deleted_request_guard BEFORE INSERT ON brand_advances
WHEN EXISTS (SELECT 1 FROM deleted_advance_requests WHERE id=NEW.id) BEGIN
  SELECT RAISE(ABORT,'ADVANCE_REQUEST_DELETED');
END;
