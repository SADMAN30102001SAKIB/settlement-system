import { expect, it } from 'vitest';
import type { PaymentAccount } from '../../../shared/receipts';
import { dateBalances } from './date-balances';

function invoice(
  overrides: Partial<PaymentAccount['invoices'][number]> = {},
): PaymentAccount['invoices'][number] {
  return {
    id: 'invoice',
    kind: 'commission',
    invoiceNumber: 'INV',
    date: '2026-10-10',
    period: 'October',
    total: 10000,
    paid: 0,
    due: 10000,
    credit: 0,
    revision: 1,
    ...overrides,
  };
}

it('combines multiple bills on their original date while keeping categories separate', () => {
  const invoices = [
    invoice({ id: 'c1', paid: 2000, due: 8000 }),
    invoice({ id: 'c2', total: 6000, paid: 1000, due: 5000 }),
    invoice({ id: 'a1', kind: 'ads', total: 22000, paid: 6000, due: 16000 }),
    invoice({
      id: 'next',
      date: '2026-10-11',
      total: 8000,
      paid: 0,
      due: 8000,
    }),
  ];
  const original = structuredClone(invoices);
  expect(dateBalances(invoices)).toEqual([
    {
      date: '2026-10-11',
      invoiceCount: 1,
      commission: { billed: 8000, paid: 0, due: 8000, credit: 0 },
      ads: { billed: 0, paid: 0, due: 0, credit: 0 },
    },
    {
      date: '2026-10-10',
      invoiceCount: 3,
      commission: { billed: 16000, paid: 3000, due: 13000, credit: 0 },
      ads: { billed: 22000, paid: 6000, due: 16000, credit: 0 },
    },
  ]);
  expect(invoices).toEqual(original);
});

it('does not move a legacy overpayment to another bill on the same date', () => {
  const rows = dateBalances([
    invoice({ paid: 12000, due: 0, credit: 2000 }),
    invoice({ id: 'still-due', total: 5000, paid: 0, due: 5000 }),
    invoice({
      id: 'advance',
      kind: 'ads',
      total: 22000,
      paid: 30000,
      due: 0,
      credit: 8000,
    }),
  ]);
  expect(rows[0]?.commission).toEqual({
    billed: 15000,
    paid: 12000,
    due: 5000,
    credit: 2000,
  });
  expect(rows[0]?.ads).toEqual({
    billed: 22000,
    paid: 30000,
    due: 0,
    credit: 8000,
  });
});

it('reflects subsequent instalments and reversals without changing bill dates or billed amounts', () => {
  const original = invoice(),
    first = invoice({ paid: 2000, due: 8000 }),
    second = invoice({ paid: 5000, due: 5000 });
  expect(dateBalances([first])[0]?.commission.paid).toBe(2000);
  expect(dateBalances([second])[0]?.commission.paid).toBe(5000);
  expect(dateBalances([first])[0]?.commission.due).toBe(8000);
  expect(dateBalances([original])[0]).toMatchObject({
    date: original.date,
    commission: { billed: 10000, due: 10000 },
  });
});

it('keeps settled and non-payable bills visible and handles empty or single-category accounts', () => {
  expect(dateBalances([])).toEqual([]);
  const result = dateBalances([
    invoice({ kind: 'ads', total: 0, due: 0 }),
    invoice({ id: 'paid', paid: 10000, due: 0 }),
  ]);
  expect(result[0]).toMatchObject({
    invoiceCount: 2,
    commission: { billed: 10000, paid: 10000, due: 0 },
    ads: { billed: 0, paid: 0, due: 0 },
  });
});
