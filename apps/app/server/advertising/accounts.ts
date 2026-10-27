import { adInvoices, payments } from '@settlement/database/schema';
import { createDatabase } from '@settlement/database';
import { allocateBrandPayments } from '@settlement/domain/payments';
import { inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { advertisingStatus } from '../invoice-status/routes';

export async function advertisingAccounts(
  binding: D1Database,
  brandIds: string[],
) {
  const database = createDatabase(binding);
  const [invoices, totals] = await database.batch([
    database
      .select({
        id: adInvoices.id,
        brandId: adInvoices.brandId,
        invoiceNumber: adInvoices.invoiceNumber,
        date: adInvoices.date,
        period: adInvoices.period,
        total: adInvoices.total,
        statusOverride: advertisingStatus,
        revision: adInvoices.revision,
        createdAt: adInvoices.createdAt,
        directPaid: sql<number>`COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ad_invoice_id = ad_invoices.id), 0)`,
      })
      .from(adInvoices)
      .where(inArray(adInvoices.brandId, brandIds))
      .limit(5001),
    database
      .select({
        brandId: payments.brandId,
        amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
      })
      .from(payments)
      .where(inArray(payments.brandId, brandIds))
      .groupBy(payments.brandId),
  ]);
  if (invoices.length > 5000)
    throw new HTTPException(422, {
      message:
        'This account needs an archived ledger before more than 5,000 invoices can be loaded.',
    });
  return new Map(
    brandIds.map((brandId) => {
      const selected = invoices.filter((item) => item.brandId === brandId);
      const accountPaid =
        totals.find((item) => item.brandId === brandId)?.amount ?? 0;
      const allocation = allocateBrandPayments(selected, accountPaid);
      return [
        brandId,
        {
          invoices: selected.map((item) => ({
            ...item,
            paid: allocation.paidByInvoice.get(item.id) ?? 0,
          })),
          accountPaid,
          total: selected.reduce((sum, item) => sum + item.total, 0),
          paid:
            accountPaid +
            selected.reduce((sum, item) => sum + item.directPaid, 0),
          advance: allocation.advance,
        },
      ] as const;
    }),
  );
}

export async function advertisingAccount(binding: D1Database, brandId: string) {
  const account = (await advertisingAccounts(binding, [brandId])).get(brandId);
  if (account === undefined) throw new Error('Missing requested account.');
  return account;
}
