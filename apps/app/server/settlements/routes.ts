import {
  brands,
  invoiceCounters,
  payments,
  settlements,
} from '@settlement/database/schema';
import { calculateSettlement } from '@settlement/domain/settlement';
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  like,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { date, id, range, revision, settlementFields } from '../validation';
import { settlementStatus } from '../invoice-status/routes';
import { invoiceDeletion } from '../invoice-deletion';

const listQuery = range.safeExtend({
  before: date.optional(),
  beforeId: id.optional(),
  q: z
    .string()
    .trim()
    .max(40)
    .regex(
      /^[a-zA-Z0-9 -]*$/,
      'Search invoice numbers using letters, digits and hyphens.',
    )
    .optional(),
});

// Drizzle removes direct column qualification in single-table selections.
const paidTotal = sql<number>`COALESCE((SELECT SUM(p.amount) FROM payments AS p WHERE p.settlement_id = settlements.id), 0)`;

export const settlementRoutes = new Hono<AppEnvironment>()
  .get('/', async (context) => {
    const query = listQuery.parse(context.req.query());
    const filters = and(
      query.from === undefined ? undefined : gte(settlements.date, query.from),
      query.to === undefined ? undefined : lte(settlements.date, query.to),
      query.brandId === undefined
        ? undefined
        : eq(settlements.brandId, query.brandId),
      query.q
        ? like(
            settlements.invoiceNumber,
            `%${query.q.replaceAll('%', '').replaceAll('_', '')}%`,
          )
        : undefined,
    );
    const pageFilters = and(
      filters,
      query.before === undefined || query.beforeId === undefined
        ? undefined
        : or(
            lt(settlements.date, query.before),
            and(
              eq(settlements.date, query.before),
              lt(settlements.id, query.beforeId),
            ),
          ),
    );
    const database = context.get('database')();
    const [items, summaries] = await database.batch([
      database
        .select({
          id: settlements.id,
          invoiceNumber: settlements.invoiceNumber,
          brandId: settlements.brandId,
          brandName: settlements.brandName,
          date: settlements.date,
          period: settlements.period,
          gross: settlements.gross,
          net: settlements.net,
          commission: settlements.commission,
          revision: settlements.revision,
          paid: paidTotal,
          statusOverride: settlementStatus,
        })
        .from(settlements)
        .where(pageFilters)
        .orderBy(desc(settlements.date), desc(settlements.id))
        .limit(51),
      database
        .select({
          count: sql<number>`COUNT(*)`,
          net: sql<number>`COALESCE(SUM(${settlements.net}), 0)`,
          commission: sql<number>`COALESCE(SUM(${settlements.commission}), 0)`,
          paid: sql<number>`COALESCE(SUM(${paidTotal}), 0)`,
          deliveredQty: sql<number>`COALESCE(SUM(${settlements.deliveredQty}), 0)`,
          deliveredAmount: sql<number>`COALESCE(SUM(${settlements.deliveredAmount}), 0)`,
          cancelledQty: sql<number>`COALESCE(SUM(${settlements.cancelledQty}), 0)`,
          cancelledAmount: sql<number>`COALESCE(SUM(CASE WHEN ${settlements.rule} = 'legacy' THEN ${settlements.cancelledAmount} ELSE 0 END), 0)`,
          partialQty: sql<number>`COALESCE(SUM(${settlements.partialQty}), 0)`,
          partialAmount: sql<number>`COALESCE(SUM(${settlements.partialAmount}), 0)`,
          pendingQty: sql<number>`COALESCE(SUM(${settlements.pendingQty}), 0)`,
          shipping: sql<number>`COALESCE(SUM(CASE WHEN ${settlements.rule} = 'v3' AND NOT ${settlements.deductShipping} THEN 0 ELSE ${settlements.shipping} END), 0)`,
          codCharge: sql<number>`COALESCE(SUM(CASE WHEN ${settlements.rule} = 'v3' THEN ${settlements.deliveredCodCharge} + ${settlements.partialCodCharge} ELSE ${settlements.codCharge} END), 0)`,
          ads: sql<number>`COALESCE(SUM(${settlements.ads} + CASE WHEN ${settlements.rule} = 'v3' AND NOT ${settlements.vatAddedToAgency} THEN (((${settlements.ads} * ${settlements.vatBasisPoints} + 5000) / 10000 + 5) / 10) * 10 ELSE 0 END), 0)`,
          productCost: sql<number>`COALESCE(SUM(${settlements.productCost}), 0)`,
        })
        .from(settlements)
        .where(filters),
    ]);
    const last = items[49];
    return context.json({
      summary: summaries[0],
      items: items.slice(0, 50),
      next:
        items.length > 50 && last !== undefined
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .get('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const database = context.get('database')();
    const [item] = await database
      .select({
        ...getTableColumns(settlements),
        paid: paidTotal,
        statusOverride: settlementStatus,
      })
      .from(settlements)
      .where(eq(settlements.id, key))
      .limit(1);
    if (item === undefined)
      throw new HTTPException(404, { message: 'Report not found.' });
    const history = await database
      .select({
        id: payments.id,
        amount: payments.amount,
        date: payments.date,
        note: payments.note,
        proofFileId: payments.proofFileId,
        receiptId: payments.receiptId,
      })
      .from(payments)
      .where(eq(payments.settlementId, key))
      .orderBy(desc(payments.date), desc(payments.id))
      .limit(200);
    return context.json({ item, payments: history });
  })
  .post('/', async (context) => {
    const input = settlementFields.parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const [brand] = await database
      .select({ name: brands.name })
      .from(brands)
      .where(eq(brands.id, input.brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const now = Date.now();
    const [counter] = await database
      .insert(invoiceCounters)
      .values({ kind: 'settlement', date: input.date, value: 1 })
      .onConflictDoUpdate({
        target: [invoiceCounters.kind, invoiceCounters.date],
        set: { value: sql`${invoiceCounters.value} + 1` },
      })
      .returning({ value: invoiceCounters.value });
    if (counter === undefined)
      throw new Error('Invoice counter did not return a value.');
    const calculation = calculateSettlement(input);
    const [item] = await database
      .insert(settlements)
      .values({
        ...input,
        id: crypto.randomUUID(),
        brandName: brand.name,
        invoiceNumber: `HEXA-${input.date.replaceAll('-', '')}-${String(counter.value).padStart(3, '0')}`,
        gross: calculation.gross,
        net: calculation.net,
        commission: calculation.commission,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return context.json(
      { item: { ...item, paid: 0, statusOverride: null } },
      201,
    );
  })
  .put('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = settlementFields
      .extend({ revision })
      .parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const [existing] = await database
      .select({
        rule: settlements.rule,
        deductShipping: settlements.deductShipping,
        vatAddedToAgency: settlements.vatAddedToAgency,
        statusOverride: settlementStatus,
      })
      .from(settlements)
      .where(eq(settlements.id, key))
      .limit(1);
    if (
      existing?.rule !== input.rule ||
      existing.deductShipping !== input.deductShipping ||
      existing.vatAddedToAgency !== input.vatAddedToAgency
    )
      throw new HTTPException(409, {
        message:
          'Saved calculation rules cannot be changed. Create a new report instead.',
      });
    const [brand] = await database
      .select({ name: brands.name })
      .from(brands)
      .where(eq(brands.id, input.brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const calculation = calculateSettlement(input);
    const [item] = await database
      .update(settlements)
      .set({
        ...input,
        brandName: brand.name,
        revision: input.revision + 1,
        gross: calculation.gross,
        net: calculation.net,
        commission: calculation.commission,
        updatedAt: Date.now(),
      })
      .where(
        and(eq(settlements.id, key), eq(settlements.revision, input.revision)),
      )
      .returning();
    if (item === undefined)
      throw new HTTPException(409, {
        message: 'This report changed or was removed. Reload before editing.',
      });
    const [paymentTotal] = await database
      .select({ paid: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.settlementId, key));
    return context.json({
      item: {
        ...item,
        paid: paymentTotal?.paid ?? 0,
        statusOverride: existing.statusOverride,
      },
    });
  })
  .get('/:id/deletion', async (context) =>
    context.json(
      await invoiceDeletion(
        context.env.DB,
        'settlement',
        id.parse(context.req.param('id')),
      ),
    ),
  )
  .delete('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = z
      .object({ revision })
      .strict()
      .parse(await context.req.json<unknown>());
    const [item] = await context
      .get('database')()
      .delete(settlements)
      .where(
        and(eq(settlements.id, key), eq(settlements.revision, input.revision)),
      )
      .returning({ id: settlements.id });
    if (item === undefined)
      throw new HTTPException(409, {
        message: 'This report changed or was removed. Reload first.',
      });
    return context.json({ ok: true });
  });
