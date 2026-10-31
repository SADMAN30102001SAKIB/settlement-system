import { expect, it } from 'vitest';
import {
  courierPdfRows,
  importDate,
  importMapping,
  mapOrder,
  parseDelimited,
} from './imports';

const pathaoHeaders = [
  'Order consignment id',
  'Order created at',
  'Collectable Amount',
  'Collected amount',
  'Cod fee',
  'Delivery fee',
  'Order status updated at',
  'Order type',
];
const pathaoRow = [
  'P0001',
  '2026-10-30 23:59:59',
  '1200',
  '900',
  '6',
  '60',
  '2026-10-31T00:10:00.000Z',
  'Delivery',
];
const pathaoMapping = importMapping(pathaoHeaders, 'pathao');
function pathao(row: string[]) {
  return mapOrder(row, pathaoMapping, 'ISO', 'courier', false, false, 'pathao');
}

it('maps Pathao collectable and collected separately and uses explicit outcome precedence', () => {
  expect(pathao(pathaoRow)).toMatchObject({
    courier: 'pathao',
    id: 'P0001',
    status: 'Delivered',
    codAmount: 1200000,
    collectedAmount: 900000,
    orderDate: '2026-10-30',
    deliveryDate: '2026-10-31',
    quantity: 1,
  });
  expect(pathao(pathaoRow.map((v, i) => (i === 3 ? '0' : v))).status).toBe(
    'Pending',
  );
  for (const amount of ['0', '900'])
    expect(
      pathao(
        pathaoRow.map((v, i) => (i === 3 ? amount : i === 7 ? ' Return ' : v)),
      ).status,
    ).toBe('Cancelled');
  for (const amount of ['', '-1', 'not money'])
    expect(() =>
      pathao(pathaoRow.map((v, i) => (i === 3 ? amount : v))),
    ).toThrow();
  expect(() =>
    pathao(pathaoRow.map((v, i) => (i === 7 ? 'Partial' : v))),
  ).toThrow('Unknown Pathao');
  expect(() =>
    pathao(pathaoRow.map((v, i) => (i === 1 ? '2026-02-30' : v))),
  ).toThrow();
  expect(() => pathao(pathaoRow.map((v, i) => (i === 6 ? '' : v)))).toThrow();
  expect(
    importMapping([...pathaoHeaders, 'Collected amount'], 'pathao')
      .collectedAmount,
  ).toBe(-1);
  expect(() =>
    mapOrder(
      pathaoRow,
      { ...pathaoMapping, collectedAmount: 2 },
      'ISO',
      'courier',
      false,
      false,
      'pathao',
    ),
  ).toThrow('different source');
  expect(() =>
    mapOrder(
      pathaoRow,
      importMapping(pathaoHeaders, 'steadfast'),
      'ISO',
      'courier',
    ),
  ).toThrow();
  expect(
    mapOrder(
      pathaoRow.slice(0, 2),
      pathaoMapping,
      'ISO',
      'orders',
      false,
      false,
      'pathao',
    ),
  ).toMatchObject({ status: 'Pending', collectedAmount: null, codAmount: 0 });
});

it('extracts supported Pathao text-PDF columns and rejects unsupported layouts', () => {
  const cells = pathaoHeaders.map((text, index) => ({
    text,
    x: index * 150,
    y: 700,
    width: 130,
  }));
  const body = pathaoRow.map((text, index) => ({
    text,
    x: index * 150,
    y: 650,
    width: 130,
  }));
  expect(courierPdfRows([[...cells, ...body]], 'pathao')).toEqual([
    pathaoHeaders,
    pathaoRow,
  ]);
  expect(() =>
    courierPdfRows([[...cells.slice(0, 7), ...body]], 'pathao'),
  ).toThrow('eight-column');
});

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
