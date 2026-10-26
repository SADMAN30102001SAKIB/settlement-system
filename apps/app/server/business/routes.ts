import {
  brands,
  dailyAds,
  expenses,
  orders,
} from '@settlement/database/schema';
import { percentage, toPaisaPrecision } from '@settlement/domain/money';
import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { date, id, money, rate, revision } from '../validation';

const orderFields = z
  .object({
    id: z.string().trim().min(1).max(100),
    orderDate: date,
    deliveryDate: date.nullable(),
    status: z.enum(['Delivered', 'Cancelled', 'Partial Delivered', 'Pending']),
    quantity: z.number().int().min(1).max(10000),
    partialQuantity: z.number().int().min(0).max(10000).nullable(),
    salesOverride: money.nullable(),
    codAmount: money,
    shipping: money,
    codCharge: money,
  })
  .strict()
  .refine(
    (item) =>
      item.partialQuantity === null || item.partialQuantity <= item.quantity,
    { message: 'Partial quantity cannot exceed quantity.' },
  )
  .refine((item) => item.status === 'Pending' || item.deliveryDate !== null, {
    message: 'Finalized orders require a delivery date.',
  });
const filterFields = z.object({
  from: date,
  to: date,
  brandId: id.optional(),
  basis: z.enum(['order', 'delivery']).default('order'),
});
const finalized = sql`${orders.status} != 'Pending'`;
const revenue = sql<number>`CASE WHEN ${orders.status} IN ('Delivered','Partial Delivered') THEN COALESCE(${orders.salesOverride}, ${orders.codAmount}) ELSE 0 END`;
const product = sql<number>`CASE WHEN ${finalized} THEN COALESCE(${orders.costPerPiece}, 0) * CASE WHEN ${orders.status} = 'Partial Delivered' THEN COALESCE(${orders.partialQuantity}, 0) ELSE ${orders.quantity} END ELSE 0 END`;

// Recompute only the touched brand/day, in the same transaction as each import.
function reallocate(binding: D1Database, brandId: string, orderDate: string) {
  return binding
    .prepare(
      `WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS position, COUNT(*) OVER () AS count
    FROM orders WHERE brand_id = ? AND order_date = ?
  ), shares AS (
    SELECT ranked.*, COALESCE((SELECT amount FROM daily_ads WHERE brand_id = ? AND order_date = ?), 0) AS total
    FROM ranked
  ), allocation AS (
    SELECT *, CAST(ROUND(total * 1.0 / count / 10) AS INTEGER) * 10 AS share FROM shares
  ) UPDATE orders SET ads = COALESCE((SELECT CASE WHEN position = count
    THEN MAX(0, total - share * (count - 1))
    ELSE MAX(0, MIN(share, total - share * (position - 1))) END FROM allocation WHERE allocation.id = orders.id), 0)
    WHERE brand_id = ? AND order_date = ?`,
    )
    .bind(brandId, orderDate, brandId, orderDate, brandId, orderDate);
}

export const businessRoutes = new Hono<AppEnvironment>()
  .get('/settlement', async (context) => {
    const query = filterFields
      .extend({ brandId: id })
      .parse(context.req.query());
    if (query.to < query.from)
      throw new HTTPException(422, { message: 'Invalid date range.' });
    const column =
      query.basis === 'order' ? orders.orderDate : orders.deliveryDate;
    const [result] = await context
      .get('database')()
      .select({
        deliveredQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' THEN 1 ELSE 0 END), 0)`,
        cancelledQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN 1 ELSE 0 END), 0)`,
        partialQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN 1 ELSE 0 END), 0)`,
        pendingQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Pending' THEN 1 ELSE 0 END), 0)`,
        deliveredAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' THEN ${revenue} ELSE 0 END), 0)`,
        cancelledAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN ${orders.codAmount} ELSE 0 END), 0)`,
        partialAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN ${revenue} ELSE 0 END), 0)`,
        shipping: sql<number>`COALESCE(SUM(CASE WHEN ${finalized} THEN ${orders.shipping} ELSE 0 END), 0)`,
        codCharge: sql<number>`COALESCE(SUM(CASE WHEN ${finalized} THEN ${orders.codCharge} ELSE 0 END), 0)`,
        ads: sql<number>`COALESCE(SUM(${orders.ads}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.brandId, query.brandId),
          gte(column, query.from),
          lte(column, query.to),
        ),
      );
    return context.json(result);
  })
  .get('/report', async (context) => {
    const query = filterFields
      .extend({ agencyBasisPoints: z.coerce.number().pipe(rate) })
      .parse(context.req.query());
    if (
      query.to < query.from ||
      (Date.parse(query.to) - Date.parse(query.from)) / 86400000 > 366
    )
      throw new HTTPException(422, {
        message: 'Choose a valid range of up to 366 days.',
      });
    const database = context.get('database')();
    const column =
      query.basis === 'order' ? orders.orderDate : orders.deliveryDate;
    const [days, otherExpenses, advertising] = await database.batch([
      database
        .select({
          date: column,
          count: sql<number>`COUNT(*)`,
          delivered: sql<number>`SUM(CASE WHEN ${orders.status} = 'Delivered' THEN 1 ELSE 0 END)`,
          cancelled: sql<number>`SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN 1 ELSE 0 END)`,
          partial: sql<number>`SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN 1 ELSE 0 END)`,
          pending: sql<number>`SUM(CASE WHEN ${orders.status} = 'Pending' THEN 1 ELSE 0 END)`,
          revenue: sql<number>`SUM(${revenue})`,
          ads: sql<number>`SUM(${orders.ads})`,
          productCost: sql<number>`SUM(${product})`,
          shipping: sql<number>`SUM(CASE WHEN ${finalized} THEN ${orders.shipping} ELSE 0 END)`,
          codCharge: sql<number>`SUM(CASE WHEN ${finalized} THEN ${orders.codCharge} ELSE 0 END)`,
          missingCosts: sql<number>`SUM(CASE WHEN ${finalized} AND (${orders.costPerPiece} IS NULL OR (${orders.status} = 'Partial Delivered' AND ${orders.partialQuantity} IS NULL)) THEN 1 ELSE 0 END)`,
          codAmount: sql<number>`SUM(${orders.codAmount})`,
        })
        .from(orders)
        .where(
          and(
            gte(column, query.from),
            lte(column, query.to),
            query.brandId === undefined
              ? undefined
              : eq(orders.brandId, query.brandId),
          ),
        )
        .groupBy(column)
        .orderBy(desc(column))
        .limit(367),
      database
        .select({
          id: expenses.id,
          date: expenses.date,
          description: expenses.description,
          amount: expenses.amount,
        })
        .from(expenses)
        .where(
          and(gte(expenses.date, query.from), lte(expenses.date, query.to)),
        )
        .orderBy(desc(expenses.date), desc(expenses.id))
        .limit(1001),
      database
        .select({
          date: dailyAds.orderDate,
          brandId: dailyAds.brandId,
          amount: dailyAds.amount,
        })
        .from(dailyAds)
        .where(
          and(
            gte(dailyAds.orderDate, query.from),
            lte(dailyAds.orderDate, query.to),
            query.brandId === undefined
              ? undefined
              : eq(dailyAds.brandId, query.brandId),
          ),
        )
        .orderBy(desc(dailyAds.orderDate), dailyAds.brandId)
        .limit(1001),
    ]);
    if (otherExpenses.length > 1000)
      throw new HTTPException(422, {
        message: 'Narrow the range to include at most 1,000 other expenses.',
      });
    if (advertising.length > 1000)
      throw new HTTPException(422, {
        message:
          'Narrow the date/brand filter to include at most 1,000 daily advertising budgets.',
      });
    const totals = days.reduce(
      (sum, day) => ({
        count: sum.count + day.count,
        delivered: sum.delivered + day.delivered,
        cancelled: sum.cancelled + day.cancelled,
        partial: sum.partial + day.partial,
        pending: sum.pending + day.pending,
        revenue: sum.revenue + day.revenue,
        ads: sum.ads + day.ads,
        productCost: sum.productCost + day.productCost,
        shipping: sum.shipping + day.shipping,
        codCharge: sum.codCharge + day.codCharge,
        missingCosts: sum.missingCosts + day.missingCosts,
      }),
      {
        count: 0,
        delivered: 0,
        cancelled: 0,
        partial: 0,
        pending: 0,
        revenue: 0,
        ads: 0,
        productCost: 0,
        shipping: 0,
        codCharge: 0,
        missingCosts: 0,
      },
    );
    const expenseTotal = otherExpenses.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const net =
      totals.revenue -
      totals.ads -
      totals.productCost -
      totals.shipping -
      totals.codCharge -
      expenseTotal;
    return context.json({
      days,
      advertising,
      expenses: otherExpenses,
      totals: {
        ...totals,
        otherExpenses: expenseTotal,
        net,
        commission: toPaisaPrecision(
          percentage(Math.max(0, net), query.agencyBasisPoints),
        ),
      },
    });
  })
  .get('/orders', async (context) => {
    const query = filterFields
      .extend({
        before: date.optional(),
        beforeId: z.string().max(100).optional(),
      })
      .parse(context.req.query());
    if (query.to < query.from)
      throw new HTTPException(422, { message: 'Invalid date range.' });
    const column =
      query.basis === 'order' ? orders.orderDate : orders.deliveryDate;
    const items = await context
      .get('database')()
      .select({
        id: orders.id,
        brandId: orders.brandId,
        orderDate: orders.orderDate,
        deliveryDate: orders.deliveryDate,
        status: orders.status,
        quantity: orders.quantity,
        partialQuantity: orders.partialQuantity,
        salesOverride: orders.salesOverride,
        costPerPiece: orders.costPerPiece,
        codAmount: orders.codAmount,
        shipping: orders.shipping,
        codCharge: orders.codCharge,
        ads: orders.ads,
        revision: orders.revision,
      })
      .from(orders)
      .where(
        and(
          gte(column, query.from),
          lte(column, query.to),
          query.brandId === undefined
            ? undefined
            : eq(orders.brandId, query.brandId),
          query.before === undefined || query.beforeId === undefined
            ? undefined
            : or(
                lt(column, query.before),
                and(eq(column, query.before), lt(orders.id, query.beforeId)),
              ),
        ),
      )
      .orderBy(desc(column), desc(orders.id))
      .limit(101);
    const last = items[99];
    return context.json({
      items: items.slice(0, 100),
      next:
        items.length > 100 && last !== undefined
          ? {
              before:
                query.basis === 'order' ? last.orderDate : last.deliveryDate,
              beforeId: last.id,
            }
          : null,
    });
  })
  .post('/import', async (context) => {
    const input = z
      .object({
        brandId: id,
        mode: z.enum(['orders', 'courier']).default('courier'),
        rows: z.array(orderFields).min(1).max(2000),
      })
      .strict()
      .parse(await context.req.json<unknown>());
    if (new Set(input.rows.map((row) => row.id)).size !== input.rows.length)
      throw new HTTPException(422, {
        message: 'The import contains duplicate order IDs.',
      });
    const database = context.get('database')();
    const [brand] = await database
      .select({ makingCost: brands.makingCost })
      .from(brands)
      .where(eq(brands.id, input.brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const binding = context.env.DB;
    // A deliberately invalid insert rolls the entire D1 batch back on cross-brand IDs.
    const statements = input.rows.map((row) =>
      binding
        .prepare(
          `INSERT INTO orders
      (id, brand_id, order_date, delivery_date, status, quantity, partial_quantity, sales_override, cost_per_piece, cod_amount, shipping, cod_charge, ads, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      brand_id = CASE WHEN orders.brand_id = excluded.brand_id THEN orders.brand_id ELSE NULL END,
      order_date = excluded.order_date, ${input.mode === 'courier' ? 'delivery_date = excluded.delivery_date, status = excluded.status, cod_amount = excluded.cod_amount, shipping = excluded.shipping, cod_charge = excluded.cod_charge,' : ''}
      revision = orders.revision + 1, updated_at = excluded.updated_at`,
        )
        .bind(
          row.id,
          input.brandId,
          row.orderDate,
          row.deliveryDate,
          row.status,
          row.quantity,
          row.partialQuantity,
          row.salesOverride,
          brand.makingCost,
          row.codAmount,
          row.shipping,
          row.codCharge,
          Date.now(),
          Date.now(),
        ),
    );
    const existingDays = await binding
      .prepare(
        'SELECT DISTINCT order_date FROM orders WHERE id IN (SELECT value FROM json_each(?)) AND brand_id = ?',
      )
      .bind(JSON.stringify(input.rows.map((row) => row.id)), input.brandId)
      .all<{ order_date: string }>();
    const dates = new Set([
      ...input.rows.map((row) => row.orderDate),
      ...existingDays.results.map((row) => row.order_date),
    ]);
    try {
      await binding.batch([
        ...statements,
        ...[...dates].map((day) => reallocate(binding, input.brandId, day)),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('NOT NULL constraint failed: orders.brand_id')
      )
        throw new HTTPException(409, {
          message:
            'An order ID already belongs to another brand. No orders were imported.',
        });
      throw error;
    }
    return context.json({ imported: input.rows.length });
  })
  .put('/orders/:id', async (context) => {
    const key = z.string().min(1).max(100).parse(context.req.param('id'));
    const input = z
      .object({
        revision,
        quantity: z.number().int().min(1).max(10000),
        partialQuantity: z.number().int().min(0).nullable(),
        salesOverride: money.nullable(),
        costPerPiece: money.nullable(),
      })
      .strict()
      .refine(
        (value) =>
          value.partialQuantity === null ||
          value.partialQuantity <= value.quantity,
        { message: 'Partial quantity cannot exceed quantity.' },
      )
      .parse(await context.req.json<unknown>());
    const [item] = await context
      .get('database')()
      .update(orders)
      .set({ ...input, revision: input.revision + 1, updatedAt: Date.now() })
      .where(and(eq(orders.id, key), eq(orders.revision, input.revision)))
      .returning({ id: orders.id });
    if (item === undefined)
      throw new HTTPException(409, {
        message: 'This order changed. Reload before editing.',
      });
    return context.json({ ok: true });
  })
  .get('/ads', async (context) => {
    const query = z
      .object({ brandId: id, from: date, to: date })
      .parse(context.req.query());
    const items = await context
      .get('database')()
      .select({ date: dailyAds.orderDate, amount: dailyAds.amount })
      .from(dailyAds)
      .where(
        and(
          eq(dailyAds.brandId, query.brandId),
          gte(dailyAds.orderDate, query.from),
          lte(dailyAds.orderDate, query.to),
        ),
      )
      .orderBy(desc(dailyAds.orderDate))
      .limit(367);
    return context.json({ items });
  })
  .put('/ads', async (context) => {
    const input = z
      .object({
        brandId: id,
        date,
        amount: money.refine((value) => value % 10 === 0, {
          message: 'Daily advertising supports at most 2 decimal places.',
        }),
      })
      .strict()
      .parse(await context.req.json<unknown>());
    const [brand] = await context
      .get('database')()
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, input.brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const binding = context.env.DB;
    await binding.batch([
      binding
        .prepare(
          'INSERT INTO daily_ads (brand_id, order_date, amount, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(brand_id, order_date) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at',
        )
        .bind(input.brandId, input.date, input.amount, Date.now()),
      reallocate(binding, input.brandId, input.date),
    ]);
    return context.json({ ok: true });
  })
  .post('/expenses', async (context) => {
    const input = z
      .object({
        date,
        description: z.string().trim().min(1).max(200),
        amount: money.refine((value) => value > 0),
      })
      .strict()
      .parse(await context.req.json<unknown>());
    await context
      .get('database')()
      .insert(expenses)
      .values({ ...input, id: crypto.randomUUID(), createdAt: Date.now() });
    return context.json({ ok: true }, 201);
  })
  .delete('/expenses/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    await context
      .get('database')()
      .delete(expenses)
      .where(eq(expenses.id, key));
    return context.json({ ok: true });
  })
  .delete('/day', async (context) => {
    const input = z
      .object({ brandId: id, date })
      .strict()
      .parse(await context.req.json<unknown>());
    const binding = context.env.DB;
    await binding.batch([
      binding
        .prepare('DELETE FROM orders WHERE brand_id = ? AND order_date = ?')
        .bind(input.brandId, input.date),
      binding
        .prepare('DELETE FROM daily_ads WHERE brand_id = ? AND order_date = ?')
        .bind(input.brandId, input.date),
    ]);
    return context.json({ ok: true });
  });
