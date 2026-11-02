-- Correct only unallocated invoices whose saved amounts match the former VAT-added rule.
UPDATE settlements
SET commission = commission - (((ads * vat_basis_points + 5000) / 10000 + 5) / 10) * 10,
    advertising_vat_only = 1,
    revision = revision + 1,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE rule = 'v3' AND vat_added_to_agency = 1 AND advertising_vat_only = 0
  AND ads > 0 AND vat_basis_points > 0
  AND net = gross - ads - product_cost
  AND commission =
    CASE WHEN net < 0
      THEN -(((-net * agency_basis_points + 5000) / 10000 + 5) / 10) * 10
      ELSE (((net * agency_basis_points + 5000) / 10000 + 5) / 10) * 10 END
    + (((ads * vat_basis_points + 5000) / 10000 + 5) / 10) * 10
  AND NOT EXISTS (SELECT 1 FROM payments WHERE settlement_id = settlements.id)
  AND NOT EXISTS (SELECT 1 FROM receipt_lines WHERE settlement_id = settlements.id);
