CREATE TRIGGER advance_version_insert AFTER INSERT ON brand_advances BEGIN
  UPDATE brands SET payment_version=payment_version+1 WHERE id=NEW.brand_id;
END;
--> statement-breakpoint
CREATE TRIGGER advance_reversal_guard BEFORE UPDATE OF reversed_at ON brand_advances
WHEN OLD.reversed_at IS NULL AND NEW.reversed_at IS NOT NULL BEGIN
  SELECT CASE WHEN OLD.amount >
    (SELECT COALESCE(SUM(amount),0) FROM brand_advances WHERE brand_id=OLD.brand_id AND reversed_at IS NULL)
    -(SELECT COALESCE(SUM(advance_amount),0) FROM payment_receipts WHERE brand_id=OLD.brand_id AND reversed_at IS NULL)
    THEN RAISE(ABORT,'ADVANCE_IN_USE') END;
END;
--> statement-breakpoint
CREATE TRIGGER advance_version_update AFTER UPDATE ON brand_advances BEGIN
  UPDATE brands SET payment_version=payment_version+1 WHERE id=NEW.brand_id;
END;
--> statement-breakpoint
CREATE TRIGGER receipt_advance_guard BEFORE INSERT ON payment_receipts WHEN NEW.advance_amount>0 BEGIN
  SELECT CASE WHEN NEW.advance_amount >
    (SELECT COALESCE(SUM(amount),0) FROM brand_advances WHERE brand_id=NEW.brand_id AND reversed_at IS NULL)
    -(SELECT COALESCE(SUM(advance_amount),0) FROM payment_receipts WHERE brand_id=NEW.brand_id AND reversed_at IS NULL)
    THEN RAISE(ABORT,'ADVANCE_IN_USE') END;
END;
--> statement-breakpoint
CREATE TRIGGER receipt_advance_version_insert AFTER INSERT ON payment_receipts WHEN NEW.advance_amount>0 BEGIN
  UPDATE brands SET payment_version=payment_version+1 WHERE id=NEW.brand_id;
END;
--> statement-breakpoint
CREATE TRIGGER receipt_advance_version_update AFTER UPDATE OF reversed_at ON payment_receipts WHEN NEW.advance_amount>0 BEGIN
  UPDATE brands SET payment_version=payment_version+1 WHERE id=NEW.brand_id;
END;
--> statement-breakpoint
CREATE TRIGGER receipt_advance_valid BEFORE INSERT ON payment_receipts WHEN NEW.advance_amount<0 OR NEW.advance_amount>NEW.total BEGIN SELECT RAISE(ABORT,'ADVANCE_IN_USE'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_advance_immutable BEFORE UPDATE OF advance_amount,brand_id,total ON payment_receipts WHEN NEW.advance_amount!=OLD.advance_amount OR NEW.brand_id!=OLD.brand_id OR NEW.total!=OLD.total BEGIN SELECT RAISE(ABORT,'RECEIPT_PAYMENT_LOCKED'); END;
