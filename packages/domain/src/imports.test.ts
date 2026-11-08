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
it('prioritizes Steadfast approval status without changing the other mappings or legacy files', () => {
  const headers = [
    'Order ID',
    'Created At',
    'Delivery Status',
    'Delivery Time',
    'COD Amount',
    'Shipping Charge',
    'COD Charge',
  ];
  const legacy = importMapping(headers, 'steadfast');
  const approval = importMapping(
    [...headers, ' Approval Status '],
    'steadfast',
  );
  expect(approval).toEqual({ ...legacy, status: 7 });
  expect(
    importMapping(
      headers.map((header) =>
        header === 'Delivery Status' ? 'Approval Status' : header,
      ),
      'steadfast',
    ),
  ).toEqual(legacy);
  const row = [
    '001',
    '2026-11-06',
    'Delivered',
    '2026-11-07',
    '1000',
    '60',
    '10',
  ];
  const original = mapOrder(row, legacy, 'ISO', 'courier');
  for (const [source, expected] of [
    ['Delivered', 'Delivered'],
    ['Cancelled', 'Cancelled'],
    ['Partially Delivered', 'Partial Delivered'],
    ['Pending', 'Pending'],
  ]) {
    expect(
      mapOrder([...row, source ?? ''], approval, 'ISO', 'courier'),
    ).toEqual({ ...original, status: expected });
  }
  for (const source of ['', 'Approved', 'unknown'])
    expect(() =>
      mapOrder([...row, source], approval, 'ISO', 'courier'),
    ).toThrow('Unknown order status');
  expect(
    importMapping(
      [...headers, 'Approval Status', 'approval status'],
      'steadfast',
    ).status,
  ).toBe(-1);
  expect(
    importMapping([...pathaoHeaders, 'Approval Status'], 'pathao'),
  ).toEqual(pathaoMapping);
});
it.each(['steadfast', 'pathao'] as const)(
  'imports zeros and only confirmed blank amounts for %s',
  (courier) => {
    const headers =
      courier === 'pathao'
        ? pathaoHeaders
        : [
            'Order ID',
            'Order date',
            'COD amount',
            'Unused',
            'COD charge',
            'Shipping charge',
            'Delivery date',
            'Status',
          ];
    const mapping = importMapping(headers, courier);
    const base = pathaoRow.map((v, i) =>
      i === 7
        ? courier === 'pathao'
          ? 'Delivery'
          : 'Delivered'
        : courier === 'pathao' && i === 3
          ? '0'
          : courier === 'steadfast' && (i === 1 || i === 6)
            ? v.slice(0, 10)
            : v,
    );
    for (const key of ['shipping', 'codCharge', 'codAmount'] as const) {
      const zero = base.map((v, i) => (i === mapping[key] ? '0' : v));
      expect(
        mapOrder(zero, mapping, 'ISO', 'courier', false, false, courier)[key],
      ).toBe(0);
      const blank = base.map((v, i) => (i === mapping[key] ? '' : v));
      expect(() =>
        mapOrder(blank, mapping, 'ISO', 'courier', false, false, courier),
      ).toThrow(`Missing ${key}`);
      expect(
        mapOrder(blank, mapping, 'ISO', 'courier', true, true, courier, true)[
          key
        ],
      ).toBe(0);
      expect(() =>
        mapOrder(
          base,
          { ...mapping, [key]: -1 },
          'ISO',
          'courier',
          true,
          true,
          courier,
          true,
        ),
      ).toThrow(`Missing ${key}`);
      for (const value of ['-1', 'not money'])
        expect(() =>
          mapOrder(
            base.map((v, i) => (i === mapping[key] ? value : v)),
            mapping,
            'ISO',
            'courier',
            true,
            true,
            courier,
            true,
          ),
        ).toThrow();
    }
    if (courier === 'pathao')
      expect(() =>
        mapOrder(
          base.map((v, i) => (i === mapping.collectedAmount ? '' : v)),
          mapping,
          'ISO',
          'courier',
          true,
          true,
          courier,
          true,
        ),
      ).toThrow('Missing Pathao collected amount');
  },
);
it('maps explicit Pathao lifecycle statuses and prefers status over legacy order type', () => {
  const headers = pathaoHeaders.map((h) =>
    h === 'Order type' ? 'Order status' : h,
  );
  const mapping = importMapping(headers, 'pathao');
  for (const [source, amount, expected] of [
    ['Accepted', '0', 'Pending'],
    ['Waiting for Picked', '0', 'Pending'],
    ['Waiting for Pickup', '0', 'Pending'],
    ['In Transit', '0', 'Pending'],
    ['Ready for Delivery', '0', 'Pending'],
    ['At Delivery Hub', '0', 'Pending'],
    ['On the Way To Delivery Hub', '0', 'Pending'],
    ['Assigned For Delivery', '0', 'Pending'],
    ['Return In Transit', '0', 'Pending'],
    ['On hold', '0', 'Pending'],
    ['Delivered', '1200', 'Delivered'],
    ['Delivered', '900', 'Partial Delivered'],
    ['  PAID   RETURN ', '170', 'Partial Delivered'],
    ['Paid Return', '0', 'Cancelled'],
    ['Return Requested', '0', 'Cancelled'],
    ['Return', '900', 'Partial Delivered'],
    ['Accepted', '900', 'Partial Delivered'],
    ['Return', '0', 'Cancelled'],
  ]) {
    const row = pathaoRow.map((v, i) =>
      i === 7 ? (source ?? '') : i === 3 ? (amount ?? '') : v,
    );
    expect(
      mapOrder(row, mapping, 'ISO', 'courier', false, false, 'pathao').status,
    ).toBe(expected);
  }
  const both = importMapping([...pathaoHeaders, 'Order status'], 'pathao');
  expect(both.status).toBe(8);
  expect(
    mapOrder(
      [...pathaoRow, 'Paid Return'],
      both,
      'ISO',
      'courier',
      false,
      false,
      'pathao',
    ).status,
  ).toBe('Partial Delivered');
  expect(importMapping([...headers, 'Order status'], 'pathao').status).toBe(-1);
  for (const [status, amount] of [
    ['', '900'],
    ['Delivered', '0'],
    ['Delivered', '1200.01'],
    ['Unrecognized', '0'],
  ])
    expect(() =>
      mapOrder(
        pathaoRow.map((v, i) =>
          i === 7 ? (status ?? '') : i === 3 ? (amount ?? '') : v,
        ),
        mapping,
        'ISO',
        'courier',
        false,
        false,
        'pathao',
      ),
    ).toThrow();
});
function pathao(row: string[]) {
  return mapOrder(row, pathaoMapping, 'ISO', 'courier', false, false, 'pathao');
}

it.each([
  'Return',
  'Return Requested',
  'Paid Return',
  'Returned To Merchant',
  'Return At Sorting Hub',
  'Pickup Cancel',
  'Pickup Failed',
])(
  'maps Pathao %s using collected amounts without changing Steadfast',
  (source) => {
    for (const collected of ['0', '900', '1200']) {
      const row = pathaoRow.map((value, index) =>
        index === 7
          ? `  ${source.toUpperCase().replaceAll(' ', '   ')}  `
          : index === 3
            ? collected
            : value,
      );
      expect(pathao(row)).toMatchObject({
        status:
          collected === '0'
            ? 'Cancelled'
            : collected === '900'
              ? 'Partial Delivered'
              : 'Delivered',
        deliveryDate: collected === '0' ? null : '2026-10-31',
        orderDate: '2026-10-30',
        collectedAmount: Number(collected) * 1000,
      });
      const headers = [
        'Order ID',
        'Order date',
        'COD amount',
        'Unused',
        'COD charge',
        'Shipping charge',
        'Delivery date',
        'Approval Status',
      ];
      expect(() =>
        mapOrder(
          row.map((value, index) =>
            index === 1 || index === 6 ? value.slice(0, 10) : value,
          ),
          importMapping(headers, 'steadfast'),
          'ISO',
          'courier',
        ),
      ).toThrow('Unknown order status');
    }
  },
);

it('maps Pathao collectable and collected separately and uses explicit outcome precedence', () => {
  expect(pathao(pathaoRow)).toMatchObject({
    courier: 'pathao',
    id: 'P0001',
    status: 'Partial Delivered',
    codAmount: 1200000,
    collectedAmount: 900000,
    orderDate: '2026-10-30',
    deliveryDate: '2026-10-31',
    quantity: 1,
  });
  expect(pathao(pathaoRow.map((v, i) => (i === 3 ? '0' : v))).status).toBe(
    'Pending',
  );
  for (const amount of ['0', '900', '1200'])
    expect(
      pathao(
        pathaoRow.map((v, i) => (i === 3 ? amount : i === 7 ? ' Return ' : v)),
      ).status,
    ).toBe(
      amount === '0'
        ? 'Cancelled'
        : amount === '1200'
          ? 'Delivered'
          : 'Partial Delivered',
    );
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

it('keeps Pathao booking dates separate from outcome dates', () => {
  for (const source of ['On hold', 'Return Requested', 'Paid Return']) {
    const order = pathao(
      pathaoRow.map((v, i) =>
        i === 7 ? source : i === 3 ? '0' : i === 6 ? '' : v,
      ),
    );
    expect(order.orderDate).toBe('2026-10-30');
    expect(order.deliveryDate).toBeNull();
  }
  for (const amount of ['900', '1200']) {
    const row = pathaoRow.map((v, i) =>
      i === 7 ? 'Delivered' : i === 3 ? amount : v,
    );
    expect(pathao(row)).toMatchObject({
      orderDate: '2026-10-30',
      deliveryDate: '2026-10-31',
    });
    expect(() => pathao(row.map((v, i) => (i === 6 ? '' : v)))).toThrow();
  }
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
