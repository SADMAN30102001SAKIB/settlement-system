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
    courier: z.enum(['steadfast', 'pathao']).default('steadfast'),
    collectedAmount: money.nullable().default(null),
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
  })
  .refine(
    (item) =>
      item.courier === 'steadfast'
        ? item.collectedAmount === null
        : item.collectedAmount === null
          ? item.status === 'Pending'
          : item.status === 'Cancelled' ||
            (item.collectedAmount > 0
              ? item.status === 'Delivered'
              : item.status === 'Pending'),
    { message: 'Pathao requires a matching collection and delivery outcome.' },
  );
const filterFields = z.object({
  from: date,
  to: date,
  brandId: id.optional(),
  basis: z.enum(['order', 'delivery']).default('order'),
});
const finalized = sql`${orders.status} IN ('Delivered','Partial Delivered')`;
const revenue = sql<number>`CASE WHEN ${finalized} THEN COALESCE(${orders.collectedAmount}, ${orders.salesOverride}, ${orders.codAmount}) ELSE 0 END`;
const product = sql<number>`CASE WHEN ${orders.status} = 'Delivered' THEN COALESCE(${orders.costPerPiece}, 0) * ${orders.quantity} ELSE 0 END`;

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
  .get('/daily', async (context) => {
    const query = filterFields
      .extend({ before: date.optional(), beforeBrand: id.optional() })
      .parse(context.req.query());
    if (
      query.to < query.from ||
      (Date.parse(query.to) - Date.parse(query.from)) / 86400000 > 366
    )
      throw new HTTPException(422, {
        message: 'Choose a valid range of up to 366 days.',
      });
    const cursor = query.before && query.beforeBrand;
    const where = `order_date BETWEEN ? AND ? ${query.brandId ? 'AND brand_id=?' : ''}
      ${cursor ? 'AND (order_date<? OR (order_date=? AND brand_id>?))' : ''}`;
    const params = [
      query.from,
      query.to,
      ...(query.brandId ? [query.brandId] : []),
      ...(cursor ? [query.before, query.before, query.beforeBrand] : []),
    ];
    const result = await context.env.DB.prepare(
      `WITH order_keys AS (
      SELECT DISTINCT order_date AS date,brand_id AS brandId FROM orders WHERE ${where} ORDER BY date DESC,brandId LIMIT 21
    ), ad_keys AS (
      SELECT order_date AS date,brand_id AS brandId FROM daily_ads WHERE ${where} ORDER BY date DESC,brandId LIMIT 21
    ), page AS (SELECT * FROM order_keys UNION SELECT * FROM ad_keys ORDER BY date DESC,brandId LIMIT 21)
    SELECT p.date,p.brandId,COUNT(o.id) AS count,
      SUM(CASE WHEN o.status='Delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN o.status='Cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN o.status='Partial Delivered' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN o.status='Pending' THEN 1 ELSE 0 END) AS pending,a.amount
    FROM page p LEFT JOIN orders o ON o.brand_id=p.brandId AND o.order_date=p.date
    LEFT JOIN daily_ads a ON a.brand_id=p.brandId AND a.order_date=p.date
    GROUP BY p.date,p.brandId ORDER BY p.date DESC,p.brandId`,
    )
      .bind(...params, ...params)
      .all<{
        date: string;
        brandId: string;
        count: number;
        delivered: number;
        cancelled: number;
        partial: number;
        pending: number;
        amount: number | null;
      }>();
    const days = result.results.slice(0, 20),
      last = days.at(-1);
    return context.json({
      days,
      next:
        result.results.length > 20 && last
          ? { before: last.date, beforeBrand: last.brandId }
          : null,
    });
  })
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
        deliveredUnits: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' THEN ${orders.quantity} ELSE 0 END), 0)`,
        cancelledQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN 1 ELSE 0 END), 0)`,
        partialQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN 1 ELSE 0 END), 0)`,
        pendingQty: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Pending' THEN 1 ELSE 0 END), 0)`,
        deliveredAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' THEN ${revenue} ELSE 0 END), 0)`,
        cancelledAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN ${orders.codAmount} ELSE 0 END), 0)`,
        partialAmount: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN ${revenue} ELSE 0 END), 0)`,
        shipping: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} != 'Pending' THEN ${orders.shipping} ELSE 0 END), 0)`,
        productCost: sql<number>`COALESCE(SUM(${product}), 0)`,
        missingCosts: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' AND ${orders.costPerPiece} IS NULL THEN 1 ELSE 0 END), 0)`,
        codCharge: sql<number>`COALESCE(SUM(CASE WHEN ${finalized} THEN ${orders.codCharge} ELSE 0 END), 0)`,
        deliveredCodCharge: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Delivered' THEN ${orders.codCharge} ELSE 0 END), 0)`,
        partialCodCharge: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN ${orders.codCharge} ELSE 0 END), 0)`,
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
    if ((result?.missingCosts ?? 0) > 0)
      throw new HTTPException(422, {
        message:
          'Correct missing making costs in Business Tracking before loading a settlement.',
      });
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
    const [grouped, otherExpenses, advertising] = await database.batch([
      database
        .select({
          date: column,
          brandId: orders.brandId,
          count: sql<number>`COUNT(*)`,
          delivered: sql<number>`SUM(CASE WHEN ${orders.status} = 'Delivered' THEN 1 ELSE 0 END)`,
          cancelled: sql<number>`SUM(CASE WHEN ${orders.status} = 'Cancelled' THEN 1 ELSE 0 END)`,
          partial: sql<number>`SUM(CASE WHEN ${orders.status} = 'Partial Delivered' THEN 1 ELSE 0 END)`,
          pending: sql<number>`SUM(CASE WHEN ${orders.status} = 'Pending' THEN 1 ELSE 0 END)`,
          revenue: sql<number>`SUM(${revenue} - CASE WHEN ${finalized} THEN ${orders.codCharge} ELSE 0 END)`,
          ads: sql<number>`SUM(${orders.ads})`,
          productCost: sql<number>`SUM(${product})`,
          shipping: sql<number>`SUM(CASE WHEN ${orders.status} != 'Pending' THEN ${orders.shipping} ELSE 0 END)`,
          codCharge: sql<number>`SUM(CASE WHEN ${finalized} THEN ${orders.codCharge} ELSE 0 END)`,
          missingCosts: sql<number>`SUM(CASE WHEN ${orders.status} = 'Delivered' AND ${orders.costPerPiece} IS NULL THEN 1 ELSE 0 END)`,
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
        .groupBy(column, orders.brandId)
        .orderBy(desc(column))
        .limit(1001),
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
    if (grouped.length > 1000)
      throw new HTTPException(422, {
        message: 'Narrow the filter to at most 1,000 brand/day groups.',
      });
    const brandDays = grouped.map((day) => {
      const ads = toPaisaPrecision(day.ads + percentage(day.ads, 1000));
      const net = day.revenue - day.shipping - ads - day.productCost;
      return {
        ...day,
        ads,
        net,
        commission: toPaisaPrecision(
          percentage(Math.max(0, net), query.agencyBasisPoints),
        ),
      };
    });
    const byDate = new Map<
      string,
      Omit<(typeof brandDays)[number], 'brandId'> & { otherExpenses: number }
    >();
    for (const day of brandDays) {
      if (day.date === null) continue;
      const current = byDate.get(day.date);
      if (current === undefined)
        byDate.set(day.date, { ...day, otherExpenses: 0 });
      else
        for (const key of [
          'count',
          'delivered',
          'cancelled',
          'partial',
          'pending',
          'revenue',
          'ads',
          'productCost',
          'shipping',
          'codCharge',
          'missingCosts',
          'codAmount',
        ] as const)
          current[key] += day[key];
    }
    if (query.brandId === undefined)
      for (const expense of otherExpenses) {
        let day = byDate.get(expense.date);
        if (day === undefined) {
          day = {
            date: expense.date,
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
            codAmount: 0,
            net: 0,
            commission: 0,
            otherExpenses: 0,
          };
          byDate.set(expense.date, day);
        }
        day.otherExpenses += expense.amount;
      }
    const days = [...byDate.values()]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map((day) => {
        const net =
          day.revenue -
          day.shipping -
          day.ads -
          day.productCost -
          day.otherExpenses;
        return {
          ...day,
          net,
          commission: toPaisaPrecision(
            percentage(Math.max(0, net), query.agencyBasisPoints),
          ),
        };
      });
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
    const expenseTotal =
      query.brandId === undefined
        ? otherExpenses.reduce((sum, item) => sum + item.amount, 0)
        : 0;
    const net =
      totals.revenue -
      totals.shipping -
      totals.ads -
      totals.productCost -
      expenseTotal;
    return context.json({
      days,
      brandDays,
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
        q: z.string().trim().max(100).optional(),
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
        courier: orders.courier,
        collectedAmount: orders.collectedAmount,
        shipping: orders.shipping,
        codCharge: orders.codCharge,
        ads: orders.ads,
        revision: orders.revision,
      })
      .from(orders)
      .where(
        and(
          query.q ? eq(orders.id, query.q) : gte(column, query.from),
          query.q ? undefined : lte(column, query.to),
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
      .limit(21);
    const last = items[19];
    return context.json({
      items: items.slice(0, 20),
      next:
        items.length > 20 && last !== undefined
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
    if (
      input.mode === 'courier' &&
      input.rows.some(
        (row) => row.courier === 'pathao' && row.collectedAmount === null,
      )
    )
      throw new HTTPException(422, {
        message: 'Pathao courier updates require an explicit collected amount.',
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
      (id, brand_id, order_date, delivery_date, status, quantity, partial_quantity, sales_override, cost_per_piece, cod_amount, shipping, cod_charge, courier, collected_amount, ads, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
      brand_id = CASE WHEN orders.brand_id = excluded.brand_id AND orders.courier = excluded.courier THEN orders.brand_id ELSE NULL END,
      order_date = excluded.order_date, ${input.mode === 'courier' ? 'delivery_date = excluded.delivery_date, status = excluded.status, cod_amount = excluded.cod_amount, shipping = excluded.shipping, cod_charge = excluded.cod_charge, collected_amount = excluded.collected_amount,' : ''}
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
          row.courier,
          row.collectedAmount,
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
            'An order ID already belongs to another brand or courier. No orders were imported.',
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
        brandId: id.optional(),
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
    const database = context.get('database')();
    const [existing] = await database
      .select({ brandId: orders.brandId, date: orders.orderDate })
      .from(orders)
      .where(eq(orders.id, key))
      .limit(1);
    if (existing === undefined)
      throw new HTTPException(409, {
        message: 'Order not found. Reload before editing.',
      });
    const brandId = input.brandId ?? existing.brandId;
    const [brand] = await database
      .select({ cost: brands.makingCost })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const binding = context.env.DB;
    let changed = 0;
    try {
      const results = await binding.batch([
        binding
          .prepare(
            'UPDATE orders SET brand_id = CASE WHEN revision = ? THEN ? ELSE NULL END, quantity = ?, partial_quantity = ?, sales_override = ?, cost_per_piece = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
          )
          .bind(
            input.revision,
            brandId,
            input.quantity,
            input.partialQuantity,
            input.salesOverride,
            brandId === existing.brandId ? input.costPerPiece : brand.cost,
            Date.now(),
            key,
          ),
        reallocate(binding, existing.brandId, existing.date),
        ...(brandId === existing.brandId
          ? []
          : [reallocate(binding, brandId, existing.date)]),
      ]);
      changed = results[0]?.meta.changes ?? 0;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('NOT NULL constraint failed: orders.brand_id')
      )
        throw new HTTPException(409, {
          message: 'This order changed. Reload before editing.',
        });
      throw error;
    }
    if (changed === 0)
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
