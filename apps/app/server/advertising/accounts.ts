import { adInvoices, payments } from '@settlement/database/schema';
import { createDatabase } from '@settlement/database';
import { allocateBrandPayments } from '@settlement/domain/payments';
import { eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

export async function advertisingAccount(binding: D1Database, brandId: string) {
  const database = createDatabase(binding);
  const [invoices, totals] = await database.batch([
    database
      .select({
        id: adInvoices.id,
        invoiceNumber: adInvoices.invoiceNumber,
        date: adInvoices.date,
        period: adInvoices.period,
        total: adInvoices.total,
        revision: adInvoices.revision,
        createdAt: adInvoices.createdAt,
        directPaid: sql<number>`COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.ad_invoice_id = ad_invoices.id), 0)`,
      })
      .from(adInvoices)
      .where(eq(adInvoices.brandId, brandId))
      .limit(5001),
    database
      .select({ amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.brandId, brandId)),
  ]);
  if (invoices.length > 5000)
    throw new HTTPException(422, {
      message:
        'This account needs an archived ledger before more than 5,000 invoices can be loaded.',
    });
  const accountPaid = totals[0]?.amount ?? 0;
  const allocation = allocateBrandPayments(invoices, accountPaid);
  return {
    invoices: invoices.map((item) => ({
      ...item,
      paid: allocation.paidByInvoice.get(item.id) ?? 0,
    })),
    accountPaid,
    total: invoices.reduce((sum, item) => sum + item.total, 0),
    paid:
      accountPaid + invoices.reduce((sum, item) => sum + item.directPaid, 0),
    advance: allocation.advance,
  };
}
