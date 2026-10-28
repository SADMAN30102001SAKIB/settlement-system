import { HTTPException } from 'hono/http-exception';

export async function invoiceDeletion(
  db: D1Database,
  kind: 'settlement' | 'ads',
  key: string,
) {
  const table = kind === 'settlement' ? 'settlements' : 'ad_invoices';
  const column = kind === 'settlement' ? 'settlement_id' : 'ad_invoice_id';
  const invoice = await db
    .prepare(`SELECT id FROM ${table} WHERE id=?`)
    .bind(key)
    .first();
  if (!invoice) throw new HTTPException(404, { message: 'Invoice not found.' });
  const receipts = await db
    .prepare(
      `SELECT r.id,r.number,
    EXISTS(SELECT 1 FROM receipt_lines other WHERE other.receipt_id=r.id AND other.id<>l.id) AS shared
    FROM receipt_lines l JOIN payment_receipts r ON r.id=l.receipt_id
    WHERE l.${column}=? AND r.reversed_at IS NULL LIMIT 21`,
    )
    .bind(key)
    .all<{ id: string; number: string; shared: number }>();
  return {
    allowed: receipts.results.length === 0,
    receipts: receipts.results
      .slice(0, 20)
      .map((r) => ({ ...r, shared: r.shared === 1 })),
    more: receipts.results.length > 20,
  };
}
