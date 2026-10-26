import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const admins = sqliteTable(
  'admins',
  {
    id: integer().primaryKey(),
    username: text().notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [check('single_admin', sql`${table.id} = 1`)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    adminId: integer('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('sessions_expiry_idx').on(table.expiresAt)],
);

export const loginAttempts = sqliteTable('login_attempts', {
  key: text().primaryKey(),
  failures: integer().notNull().default(0),
  windowStartedAt: integer('window_started_at').notNull(),
  lockedUntil: integer('locked_until').notNull().default(0),
});

export const brands = sqliteTable(
  'brands',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    normalizedName: text('normalized_name').notNull().unique(),
    makingCost: integer('making_cost'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check(
      'brands_cost_nonnegative',
      sql`${table.makingCost} IS NULL OR ${table.makingCost} >= 0`,
    ),
  ],
);

export const files = sqliteTable(
  'files',
  {
    id: text().primaryKey(),
    objectKey: text('object_key').notNull().unique(),
    filename: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    kind: text({
      enum: ['proof', 'courier', 'watermark', 'signature'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('files_size_positive', sql`${table.size} > 0`),
    index('files_created_idx').on(table.createdAt, table.id),
  ],
);

export const settings = sqliteTable(
  'settings',
  {
    id: integer().primaryKey(),
    companyName: text('company_name').notNull().default('Hexa Agency Ltd.'),
    address: text().notNull().default('Binodpur Bazar, Rajshahi'),
    phone: text().notNull().default(''),
    email: text().notNull().default(''),
    signatureLabel: text('signature_label')
      .notNull()
      .default('Authorized Signature'),
    agencyBasisPoints: integer('agency_basis_points').notNull().default(1500),
    watermarkFileId: text('watermark_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    signatureFileId: text('signature_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('single_settings', sql`${table.id} = 1`),
    check(
      'valid_agency_percentage',
      sql`${table.agencyBasisPoints} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    id: text().primaryKey(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    orderDate: text('order_date').notNull(),
    deliveryDate: text('delivery_date'),
    status: text({
      enum: ['Delivered', 'Cancelled', 'Partial Delivered', 'Pending'],
    }).notNull(),
    quantity: integer().notNull().default(1),
    partialQuantity: integer('partial_quantity'),
    salesOverride: integer('sales_override'),
    costPerPiece: integer('cost_per_piece'),
    codAmount: integer('cod_amount').notNull(),
    shipping: integer().notNull(),
    codCharge: integer('cod_charge').notNull(),
    ads: integer().notNull().default(0),
    revision: integer().notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('orders_brand_order_date_idx').on(
      table.brandId,
      table.orderDate,
      table.id,
    ),
    index('orders_order_date_idx').on(table.orderDate, table.id),
    index('orders_brand_delivery_date_idx').on(
      table.brandId,
      table.deliveryDate,
      table.id,
    ),
    index('orders_delivery_date_idx').on(table.deliveryDate, table.id),
    check(
      'orders_valid_status',
      sql`${table.status} IN ('Delivered','Cancelled','Partial Delivered','Pending')`,
    ),
    check('orders_positive_quantity', sql`${table.quantity} >= 1`),
    check(
      'orders_valid_partial_quantity',
      sql`${table.partialQuantity} IS NULL OR ${table.partialQuantity} BETWEEN 0 AND ${table.quantity}`,
    ),
    check(
      'orders_nonnegative_amounts',
      sql`${table.codAmount} >= 0 AND ${table.shipping} >= 0 AND ${table.codCharge} >= 0 AND ${table.ads} >= 0 AND (${table.salesOverride} IS NULL OR ${table.salesOverride} >= 0) AND (${table.costPerPiece} IS NULL OR ${table.costPerPiece} >= 0)`,
    ),
  ],
);

export const dailyAds = sqliteTable(
  'daily_ads',
  {
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    orderDate: text('order_date').notNull(),
    amount: integer().notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.brandId, table.orderDate] }),
    index('daily_ads_date_idx').on(table.orderDate, table.brandId),
    check('daily_ads_nonnegative', sql`${table.amount} >= 0`),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text().primaryKey(),
    date: text().notNull(),
    description: text().notNull(),
    amount: integer().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('expenses_date_idx').on(table.date, table.id),
    check('expenses_nonnegative', sql`${table.amount} >= 0`),
  ],
);

export const invoiceCounters = sqliteTable(
  'invoice_counters',
  {
    kind: text({ enum: ['settlement', 'ads'] }).notNull(),
    date: text().notNull(),
    value: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.date] })],
);

export const settlements = sqliteTable(
  'settlements',
  {
    id: text().primaryKey(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    brandName: text('brand_name').notNull(),
    date: text().notNull(),
    period: text().notNull(),
    rule: text({ enum: ['legacy', 'v2'] })
      .notNull()
      .default('v2'),
    deliveredQty: integer('delivered_qty').notNull(),
    deliveredAmount: integer('delivered_amount').notNull(),
    cancelledQty: integer('cancelled_qty').notNull(),
    cancelledAmount: integer('cancelled_amount').notNull(),
    partialQty: integer('partial_qty').notNull(),
    partialAmount: integer('partial_amount').notNull(),
    pendingQty: integer('pending_qty').notNull().default(0),
    shipping: integer().notNull(),
    codCharge: integer('cod_charge').notNull(),
    ads: integer().notNull(),
    productCost: integer('product_cost').notNull(),
    costPerPiece: integer('cost_per_piece'),
    agencyBasisPoints: integer('agency_basis_points').notNull(),
    gross: integer().notNull(),
    net: integer().notNull(),
    commission: integer().notNull(),
    sourceFileId: text('source_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    revision: integer().notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('settlements_brand_date_idx').on(table.brandId, table.date, table.id),
    index('settlements_date_idx').on(table.date, table.id),
    check('settlements_valid_rule', sql`${table.rule} IN ('legacy','v2')`),
    check(
      'settlements_valid_rate',
      sql`${table.agencyBasisPoints} BETWEEN 0 AND 10000`,
    ),
    check(
      'settlements_nonnegative_counts',
      sql`${table.deliveredQty} >= 0 AND ${table.cancelledQty} >= 0 AND ${table.partialQty} >= 0 AND ${table.pendingQty} >= 0`,
    ),
    check(
      'settlements_nonnegative_inputs',
      sql`${table.deliveredAmount} >= 0 AND ${table.cancelledAmount} >= 0 AND ${table.partialAmount} >= 0 AND ${table.shipping} >= 0 AND ${table.codCharge} >= 0 AND ${table.ads} >= 0 AND ${table.productCost} >= 0`,
    ),
  ],
);

export const adInvoices = sqliteTable(
  'ad_invoices',
  {
    id: text().primaryKey(),
    invoiceNumber: text('invoice_number').notNull().unique(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    brandName: text('brand_name').notNull(),
    date: text().notNull(),
    period: text().notNull(),
    normalizedPeriod: text('normalized_period').notNull(),
    total: integer().notNull(),
    revision: integer().notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('ad_invoices_brand_period_idx').on(
      table.brandId,
      table.normalizedPeriod,
    ),
    index('ad_invoices_brand_date_idx').on(table.brandId, table.date, table.id),
    index('ad_invoices_date_idx').on(table.date, table.id),
    check('ad_invoices_nonnegative', sql`${table.total} >= 0`),
  ],
);

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text().primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => adInvoices.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    name: text().notNull(),
    amount: integer().notNull(),
  },
  (table) => [
    uniqueIndex('campaigns_invoice_position_idx').on(
      table.invoiceId,
      table.position,
    ),
    check('campaigns_nonnegative', sql`${table.amount} >= 0`),
  ],
);

export const payments = sqliteTable(
  'payments',
  {
    id: text().primaryKey(),
    settlementId: text('settlement_id').references(() => settlements.id, {
      onDelete: 'cascade',
    }),
    adInvoiceId: text('ad_invoice_id').references(() => adInvoices.id, {
      onDelete: 'cascade',
    }),
    brandId: text('brand_id').references(() => brands.id, {
      onDelete: 'restrict',
    }),
    amount: integer().notNull(),
    date: text().notNull(),
    note: text().notNull().default(''),
    proofFileId: text('proof_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('payments_settlement_idx').on(
      table.settlementId,
      table.date,
      table.id,
    ),
    index('payments_ad_invoice_idx').on(
      table.adInvoiceId,
      table.date,
      table.id,
    ),
    index('payments_brand_idx').on(table.brandId, table.date, table.id),
    check('payments_positive', sql`${table.amount} > 0`),
    check(
      'payments_exactly_one_target',
      sql`(${table.settlementId} IS NOT NULL) + (${table.adInvoiceId} IS NOT NULL) + (${table.brandId} IS NOT NULL) = 1`,
    ),
  ],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text().primaryKey(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    period: text().notNull(),
    type: text({
      enum: ['Ads Invoice ready', '15% calculated', 'Both done', 'Other'],
    }).notNull(),
    content: text().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('notes_brand_created_idx').on(
      table.brandId,
      table.createdAt,
      table.id,
    ),
    index('notes_created_idx').on(table.createdAt, table.id),
  ],
);
