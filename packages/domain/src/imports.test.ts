import { expect, it } from 'vitest';
import { importDate, mapOrder, parseDelimited } from './imports';

it('imports explicit item quantities without guessing invalid or missing mapped values', () => {
  const mapping = {
    orderDate: 0,
    id: 1,
    status: 2,
    deliveryDate: 3,
    codAmount: 4,
    shipping: 5,
    codCharge: 6,
    quantity: 7,
  };
  const row = [
    '2026-10-26',
    '0001',
    'Delivered',
    '2026-10-27',
    '1000',
    '60',
    '10',
    '4',
  ];
  expect(mapOrder(row, mapping, 'ISO', 'courier').quantity).toBe(4);
  expect(
    mapOrder(row, { ...mapping, quantity: -1 }, 'ISO', 'courier').quantity,
  ).toBe(1);
  for (const value of ['', '0', '1.5', '10001'])
    expect(() =>
      mapOrder([...row.slice(0, 7), value], mapping, 'ISO', 'courier'),
    ).toThrow('Quantity');
});

it('preserves quoted money, newlines, escaped quotes and leading-zero IDs', () => {
  expect(
    parseDelimited('ID,Amount,Note\r\n001,"1,234.56","line 1\nline ""2"""'),
  ).toEqual([
    ['ID', 'Amount', 'Note'],
    ['001', '1,234.56', 'line 1\nline "2"'],
  ]);
  expect(parseDelimited('ID\tDate\n001\t2026-10-26')).toEqual([
    ['ID', 'Date'],
    ['001', '2026-10-26'],
  ]);
  expect(() => parseDelimited('"unfinished')).toThrow();
});
it('does not guess ambiguous dates or roll invalid dates into another month', () => {
  expect(importDate('02/03/2026', 'DMY')).toBe('2026-03-02');
  expect(() => importDate('02/03/2026', 'ISO')).toThrow();
  expect(() => importDate('2026-02-29', 'ISO')).toThrow();
  expect(importDate('2024-02-29', 'ISO')).toBe('2024-02-29');
});
it('refuses unknown statuses and missing courier amounts instead of guessing', () => {
  const mapping = {
    id: 0,
    orderDate: 1,
    deliveryDate: 2,
    status: 3,
    codAmount: 4,
    shipping: 5,
    codCharge: 6,
  };
  const row = [
    '001',
    '2026-10-26',
    '2026-10-27',
    'Delivered',
    '1,280.00',
    '115',
    '12.80',
  ];
  expect(mapOrder(row, mapping, 'ISO', 'courier')).toMatchObject({
    id: '001',
    codAmount: 1280000,
    shipping: 115000,
    codCharge: 12800,
  });
  expect(() =>
    mapOrder(
      [...row.slice(0, 3), 'unknown', ...row.slice(4)],
      mapping,
      'ISO',
      'courier',
    ),
  ).toThrow('Unknown');
  expect(() => mapOrder(row.slice(0, 6), mapping, 'ISO', 'courier')).toThrow();
});
