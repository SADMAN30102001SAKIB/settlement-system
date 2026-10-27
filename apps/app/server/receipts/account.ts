import {
  allocateBrandPayments,
  paymentStatus,
} from '@settlement/domain/payments';
import { sumMoney, toPaisaPrecision } from '@settlement/domain/money';
import { HTTPException } from 'hono/http-exception';
import type { PaymentAccount } from '../../shared/receipts';
import { z } from 'zod';

const rowsSchema = z.array(
  z.object({
    id: z.string(),
    invoiceNumber: z.string(),
    date: z.string(),
    period: z.string(),
    total: z.number().int(),
    directPaid: z.number().int(),
    revision: z.number().int(),
    createdAt: z.number().int(),
  }),
);
export async function loadPaymentAccount(
  db: D1Database,
  brandId: string,
): Promise<PaymentAccount> {
  const [brand, commissionResult, adResult, advances] = await db.batch([
    db
      .prepare(
        'SELECT id, name, payment_version AS version FROM brands WHERE id = ?',
      )
      .bind(brandId),
    db
      .prepare(
        `SELECT s.id,s.invoice_number AS invoiceNumber,s.date,s.period,s.commission AS total,s.revision,s.created_at AS createdAt,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.settlement_id=s.id),0) AS directPaid
      FROM settlements s WHERE s.brand_id=? ORDER BY s.date,s.id LIMIT 5001`,
      )
      .bind(brandId),
    db
      .prepare(
        `SELECT a.id,a.invoice_number AS invoiceNumber,a.date,a.period,a.total,a.revision,a.created_at AS createdAt,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ad_invoice_id=a.id),0) AS directPaid
      FROM ad_invoices a WHERE a.brand_id=? ORDER BY a.date,a.id LIMIT 5001`,
      )
      .bind(brandId),
    db
      .prepare(
        'SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE brand_id=?',
      )
      .bind(brandId),
  ]);
  if (!brand || !commissionResult || !adResult || !advances)
    throw new Error('Incomplete payment account snapshot.');
  const info = brand.results[0];
  if (!info) throw new HTTPException(404, { message: 'Brand not found.' });
  const commissions = rowsSchema.parse(commissionResult.results),
    ads = rowsSchema.parse(adResult.results);
  if (commissions.length > 5000 || ads.length > 5000)
    throw new HTTPException(422, {
      message:
        'This account exceeds 5,000 invoices per category. Archive the ledger before continuing.',
    });
  const brandInfo = z
    .object({ id: z.string(), name: z.string(), version: z.number().int() })
    .parse(info);
  const pool = z
    .object({ amount: z.number().int() })
    .parse(advances.results[0]).amount;
  const allocation = allocateBrandPayments(ads, pool);
  const invoices = [
    ...commissions.map((item) => ({
      ...item,
      kind: 'commission' as const,
      total: Math.max(0, toPaisaPrecision(item.total)),
      paid: item.directPaid,
    })),
    ...ads.map((item) => ({
      ...item,
      kind: 'ads' as const,
      paid: allocation.paidByInvoice.get(item.id) ?? 0,
    })),
  ].map((item) => {
    const status = paymentStatus(item.total, item.paid);
    return {
      id: item.id,
      invoiceNumber: item.invoiceNumber,
      date: item.date,
      period: item.period,
      revision: item.revision,
      kind: item.kind,
      total: status.total,
      paid: status.paid,
      due: Math.max(0, status.balance),
      credit: Math.max(0, -status.balance),
    };
  });
  const totals = (kind: 'commission' | 'ads') => {
    const rows = invoices.filter((item) => item.kind === kind);
    return {
      billed: sumMoney(rows.map((item) => item.total)),
      paid: sumMoney(rows.map((item) => item.paid)),
      due: sumMoney(rows.map((item) => item.due)),
      credit: sumMoney(rows.map((item) => item.credit)),
    };
  };
  const adTotals = totals('ads');
  if (!ads.length) {
    adTotals.paid = pool;
    adTotals.credit = pool;
  }
  return {
    brandId,
    brandName: brandInfo.name,
    version: brandInfo.version,
    invoices,
    commission: totals('commission'),
    ads: adTotals,
  };
}
