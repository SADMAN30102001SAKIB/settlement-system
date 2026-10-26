import { expect, it } from 'vitest';
import { importDate, mapOrder, parseDelimited } from './imports';

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
