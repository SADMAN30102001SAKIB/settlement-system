CREATE TRIGGER order_cost_correction_validate BEFORE INSERT ON order_cost_corrections
BEGIN
  SELECT CASE WHEN
    NOT EXISTS (SELECT 1 FROM brands WHERE id=NEW.brand_id
      AND updated_at=json_extract(NEW.snapshot,'$.brand.updatedAt')
      AND name=json_extract(NEW.snapshot,'$.brand.name')
      AND making_cost IS json_extract(NEW.snapshot,'$.brand.makingCost'))
    OR NEW.making_cost < 0 OR NEW.from_date > NEW.to_date
    OR json_array_length(NEW.snapshot,'$.orders') > 2000
    OR (SELECT COUNT(*) FROM orders WHERE brand_id=NEW.brand_id
      AND order_date>=NEW.from_date AND order_date<=NEW.to_date AND cost_per_piece IS NOT NEW.making_cost)
      != json_array_length(NEW.snapshot,'$.orders')
    OR EXISTS (SELECT 1 FROM json_each(NEW.snapshot,'$.orders') AS saved
      WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id=json_extract(saved.value,'$.id')
        AND brand_id=NEW.brand_id AND order_date>=NEW.from_date AND order_date<=NEW.to_date
        AND revision=json_extract(saved.value,'$.revision')
        AND cost_per_piece IS json_extract(saved.value,'$.cost')
        AND quantity=json_extract(saved.value,'$.quantity') AND status=json_extract(saved.value,'$.status')))
    THEN RAISE(ABORT,'COST_CORRECTION_STALE') END;
END;
--> statement-breakpoint
CREATE TRIGGER order_cost_correction_apply AFTER INSERT ON order_cost_corrections
BEGIN
  UPDATE brands SET name=NEW.name,normalized_name=json_extract(NEW.snapshot,'$.normalizedName'),making_cost=NEW.making_cost,
    updated_at=MAX(updated_at+1,NEW.created_at) WHERE id=NEW.brand_id;
  UPDATE orders SET cost_per_piece=NEW.making_cost,revision=revision+1,updated_at=MAX(updated_at+1,NEW.created_at)
    WHERE brand_id=NEW.brand_id AND id IN (SELECT json_extract(value,'$.id') FROM json_each(NEW.snapshot,'$.orders'));
END;
