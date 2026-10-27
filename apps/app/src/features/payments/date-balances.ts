import { sumMoney } from '@settlement/domain/money';
import type { PaymentAccount } from '../../../shared/receipts';

export function dateBalances(invoices: PaymentAccount['invoices']) {
  const dates = new Map<
    string,
    {
      date: string;
      invoiceCount: number;
      commission: PaymentAccount['commission'];
      ads: PaymentAccount['ads'];
    }
  >();
  for (const invoice of invoices) {
    let row = dates.get(invoice.date);
    if (!row) {
      row = {
        date: invoice.date,
        invoiceCount: 0,
        commission: { billed: 0, paid: 0, due: 0, credit: 0 },
        ads: { billed: 0, paid: 0, due: 0, credit: 0 },
      };
      dates.set(invoice.date, row);
    }
    row.invoiceCount++;
    const category = row[invoice.kind];
    category.billed = sumMoney([category.billed, invoice.total]);
    category.paid = sumMoney([category.paid, invoice.paid]);
    category.due = sumMoney([category.due, invoice.due]);
    category.credit = sumMoney([category.credit, invoice.credit]);
  }
  return [...dates.values()].sort((a, b) => b.date.localeCompare(a.date));
}
