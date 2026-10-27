import { assertMoney, sumMoney, toPaisaPrecision } from './money';

export interface Receivable {
  id: string;
  date: string;
  createdAt: number;
  total: number;
  directPaid: number;
}

export function paymentStatus(total: number, paid: number) {
  const payable = toPaisaPrecision(total);
  const paidAmount = toPaisaPrecision(paid);
  if (paidAmount < 0) throw new RangeError('Payments cannot be negative.');
  const balance = assertMoney(payable - paidAmount);
  const status: 'Unpaid' | 'Paid' | 'Due' | 'Advance' | 'N/A' =
    paidAmount === 0
      ? payable <= 0
        ? 'N/A'
        : 'Unpaid'
      : balance > 0
        ? 'Due'
        : balance < 0
          ? 'Advance'
          : 'Paid';
  return { total: payable, paid: paidAmount, balance, status };
}

export function allocateBrandPayments(
  invoices: readonly Receivable[],
  accountPaid: number,
) {
  if (assertMoney(accountPaid) < 0)
    throw new RangeError('Account payments cannot be negative.');
  if (new Set(invoices.map((item) => item.id)).size !== invoices.length)
    throw new RangeError('Duplicate invoice IDs.');
  const ordered = [...invoices].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  let pool = sumMoney([
    accountPaid,
    ...ordered.map((invoice) => {
      if (assertMoney(invoice.total) < 0 || assertMoney(invoice.directPaid) < 0)
        throw new RangeError('Invoice amounts cannot be negative.');
      return Math.max(0, invoice.directPaid - invoice.total);
    }),
  ]);
  const allocations = new Map<string, number>();
  for (const invoice of ordered) {
    const need = Math.max(0, invoice.total - invoice.directPaid);
    const take = Math.min(pool, need);
    pool -= take;
    allocations.set(
      invoice.id,
      sumMoney([Math.min(invoice.directPaid, invoice.total), take]),
    );
  }
  const last = ordered.at(-1);
  if (last)
    allocations.set(last.id, sumMoney([allocations.get(last.id) ?? 0, pool]));
  return { paidByInvoice: allocations, advance: pool };
}
