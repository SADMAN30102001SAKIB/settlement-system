import { parseMoney } from './money';

export function parseDelimited(input: string): string[][] {
  const delimiter = input.split(/\r?\n/, 1)[0]?.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (!quoted && cell !== '')
        throw new Error('Unexpected quote inside an unquoted cell.');
      else quoted = !quoted;
    } else if (
      !quoted &&
      (char === delimiter || char === '\n' || char === '\r')
    ) {
      row.push(cell.trim());
      cell = '';
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && input[index + 1] === '\n') index++;
      }
    } else cell += char ?? '';
  }
  if (quoted) throw new Error('A quoted cell was not closed.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length > 2001)
    throw new Error('Import at most 2,000 orders at once.');
  return rows;
}

export function importDate(input: string, format: 'ISO' | 'DMY'): string {
  const match =
    format === 'ISO'
      ? /^(\d{4})-(\d{1,2})-(\d{1,2})(?: \d{1,2}:\d{2}:\d{2} (?:am|pm))?$/i.exec(
          input.trim(),
        )
      : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(input.trim());
  if (match === null)
    throw new Error(
      `Expected a ${format === 'ISO' ? 'YYYY-MM-DD' : 'DD/MM/YYYY'} date.`,
    );
  const year = Number(match[format === 'ISO' ? 1 : 3]),
    month = Number(match[2]),
    day = Number(match[format === 'ISO' ? 3 : 1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    year > 2100 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Invalid calendar date.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const importColumns = [
  'orderDate',
  'id',
  'status',
  'deliveryDate',
  'codAmount',
  'shipping',
  'codCharge',
] as const;
export type ImportColumn = (typeof importColumns)[number];
export type Courier = 'steadfast' | 'pathao';
export function importMapping(headers: readonly string[], courier: Courier) {
  const aliases: Record<
    ImportColumn | 'collectedAmount' | 'quantity',
    string[]
  > = {
    id: courier === 'pathao' ? ['order consignment id'] : ['order id'],
    orderDate:
      courier === 'pathao'
        ? ['order created at']
        : ['created at', 'order date'],
    deliveryDate:
      courier === 'pathao'
        ? ['order status updated at']
        : ['delivery time', 'delivery date'],
    status:
      courier === 'pathao' ? ['order type'] : ['delivery status', 'status'],
    codAmount: courier === 'pathao' ? ['collectable amount'] : ['cod amount'],
    collectedAmount: courier === 'pathao' ? ['collected amount'] : [],
    shipping: courier === 'pathao' ? ['delivery fee'] : ['shipping charge'],
    codCharge: courier === 'pathao' ? ['cod fee'] : ['cod charge'],
    quantity: ['quantity', 'qty', 'item quantity'],
  };
  const find = (key: keyof typeof aliases) => {
    const matches = headers.flatMap((header, index) =>
      aliases[key].includes(header.trim().toLowerCase()) ? [index] : [],
    );
    return matches.length === 1 ? (matches[0] ?? -1) : -1;
  };
  return {
    id: find('id'),
    orderDate: find('orderDate'),
    deliveryDate: find('deliveryDate'),
    status: find('status'),
    codAmount: find('codAmount'),
    collectedAmount: find('collectedAmount'),
    shipping: find('shipping'),
    codCharge: find('codCharge'),
    quantity: find('quantity'),
  };
}
export function pathaoStatus(orderType: string, collectedAmount: number) {
  const type = orderType.trim().toLowerCase();
  if (type === 'return') return 'Cancelled';
  if (type !== 'delivery')
    throw new Error(`Unknown Pathao order type: ${orderType || '(empty)'}.`);
  return collectedAmount > 0 ? 'Delivered' : 'Pending';
}
export function mapOrder(
  row: readonly string[],
  mapping: Readonly<Record<ImportColumn, number>> & {
    readonly quantity?: number;
    readonly collectedAmount?: number;
  },
  format: 'ISO' | 'DMY',
  mode: 'orders' | 'courier',
  blankCodChargeIsZero = false,
  blankCodAmountIsZero = false,
  courier: Courier = 'steadfast',
) {
  const mapped = (
    mode === 'orders'
      ? [mapping.id, mapping.orderDate, mapping.quantity]
      : [
          ...importColumns.map((key) => mapping[key]),
          mapping.quantity,
          ...(courier === 'pathao' ? [mapping.collectedAmount] : []),
        ]
  ).filter((index): index is number => index !== undefined && index >= 0);
  if (new Set(mapped).size !== mapped.length)
    throw new Error('Map each field to a different source column.');
  const get = (key: ImportColumn | 'collectedAmount') =>
    row[mapping[key] ?? -1]?.trim() ?? '';
  const collectedAmount =
    courier === 'pathao' && mode === 'courier'
      ? (() => {
          if (!get('collectedAmount'))
            throw new Error(
              'Missing Pathao collected amount. An explicit zero is required for uncollected parcels.',
            );
          const value = parseMoney(get('collectedAmount'));
          if (value < 0)
            throw new Error('Collected amount cannot be negative.');
          return value;
        })()
      : null;
  const id = get('id');
  if (!id || id.length > 100) throw new Error('Missing or invalid order ID.');
  const statuses = {
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
    'partial delivered': 'Partial Delivered',
    'partially delivered': 'Partial Delivered',
    pending: 'Pending',
  } as const;
  const rawStatus = get('status').toLowerCase();
  const status =
    mode === 'orders'
      ? 'Pending'
      : courier === 'pathao'
        ? pathaoStatus(get('status'), collectedAmount ?? 0)
        : Object.hasOwn(statuses, rawStatus)
          ? statuses[rawStatus as keyof typeof statuses]
          : undefined;
  if (status === undefined)
    throw new Error(`Unknown delivery status: ${get('status') || '(empty)'}.`);
  const amount = (key: ImportColumn) => {
    const confirmedZero =
      (key === 'codCharge' && blankCodChargeIsZero) ||
      (key === 'codAmount' && blankCodAmountIsZero);
    if (!get(key) && !confirmedZero)
      throw new Error(
        `Missing ${key}. Correct the source or explicitly confirm a zero amount.`,
      );
    const value = parseMoney(!get(key) && confirmedZero ? '0' : get(key));
    if (value < 0) throw new Error('Amounts cannot be negative.');
    return value;
  };
  return {
    id,
    courier,
    collectedAmount,
    orderDate: importDate(
      courier === 'pathao' ? pathaoDate(get('orderDate')) : get('orderDate'),
      format,
    ),
    deliveryDate:
      mode === 'orders' || (!get('deliveryDate') && status === 'Pending')
        ? null
        : importDate(
            courier === 'pathao'
              ? pathaoDate(get('deliveryDate'))
              : get('deliveryDate'),
            format,
          ),
    status,
    quantity: (() => {
      const value =
        mapping.quantity === undefined || mapping.quantity < 0
          ? '1'
          : (row[mapping.quantity]?.trim() ?? '');
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 10000)
        throw new Error(
          'Quantity must be a whole number between 1 and 10,000.',
        );
      return Number(value);
    })(),
    partialQuantity: null,
    salesOverride: null,
    codAmount: mode === 'orders' ? 0 : amount('codAmount'),
    shipping: mode === 'orders' ? 0 : amount('shipping'),
    codCharge: mode === 'orders' ? 0 : amount('codCharge'),
  };
}

function pathaoDate(value: string) {
  const timestamp =
    /^(\d{4}-\d{2}-\d{2})[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(
      value,
    );
  return timestamp?.[1] ?? value;
}

export interface PdfCell {
  text: string;
  x: number;
  y: number;
  width: number;
}
const courierHeaders = [
  'Created At',
  'Order ID',
  'Delivery Status',
  'Delivery Time',
  'COD Amount',
  'Shipping Charge',
  'COD Charge',
];
export function courierPdfRows(
  pages: readonly (readonly PdfCell[])[],
  courier: Courier = 'steadfast',
): string[][] {
  const headers =
    courier === 'pathao'
      ? [
          'Order consignment id',
          'Order created at',
          'Collectable Amount',
          'Collected amount',
          'Cod fee',
          'Delivery fee',
          'Order status updated at',
          'Order type',
        ]
      : courierHeaders;
  const rows: string[][] = [headers];
  let boundaries: number[] | undefined;
  for (const page of pages) {
    const headerCells = headers.map((header) =>
      page.find((cell) => cell.text === header),
    );
    if (headerCells.every((cell) => cell !== undefined)) {
      const centers = headerCells.map((cell) => cell.x + cell.width / 2);
      if (
        centers.some(
          (center, index) => index > 0 && center <= (centers[index - 1] ?? 0),
        )
      )
        throw new Error(
          'The PDF columns are not in the supported order. Use its original Excel/CSV.',
        );
      boundaries = centers
        .slice(1)
        .map((center, index) => (center + (centers[index] ?? center)) / 2);
    } else if (
      boundaries === undefined ||
      headerCells.some((cell) => cell !== undefined)
    )
      throw new Error(
        courier === 'pathao'
          ? 'The PDF does not have the supported eight-column Pathao layout. Use its original Excel/CSV.'
          : 'The PDF does not have the verified seven-column Steadfast layout. Use its original Excel/CSV.',
      );
    const lines = new Map<number, PdfCell[]>();
    for (const cell of page) {
      const key = Math.round(cell.y / 2) * 2;
      const line = lines.get(key) ?? [];
      line.push(cell);
      lines.set(key, line);
    }
    for (const [, line] of [...lines.entries()].sort(([a], [b]) => b - a)) {
      if (line.some((cell) => headers.includes(cell.text))) continue;
      const cells = Array.from({ length: headers.length }, () => '');
      for (const cell of line.sort((a, b) => a.x - b.x)) {
        const merged =
          /^(Partially Delivered|Partial Delivered|Delivered|Cancelled|Pending)\s+(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} (?:am|pm))$/i.exec(
            cell.text,
          );
        if (courier === 'steadfast' && merged !== null) {
          cells[2] = merged[1] ?? '';
          cells[3] = merged[2] ?? '';
          continue;
        }
        const center = cell.x + cell.width / 2;
        const found = boundaries.findIndex((boundary) => center < boundary);
        const index = found === -1 ? headers.length - 1 : found;
        cells[index] = [cells[index], cell.text].filter(Boolean).join(' ');
      }
      if (cells.every((cell) => !cell)) continue;
      if (
        !/^\d{4}-\d{2}-\d{2}/.test(cells[courier === 'pathao' ? 1 : 0] ?? '')
      ) {
        if (
          /^\d+$/.test(cells.join('').trim()) &&
          cells.join('').trim().length <= 2
        )
          continue;
        throw new Error(
          'An unrecognized PDF row could not be safely aligned. Use the original Excel/CSV.',
        );
      }
      rows.push(cells);
    }
  }
  return rows;
}
