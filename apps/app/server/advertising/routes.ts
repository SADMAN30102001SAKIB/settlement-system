import {
  adInvoices,
  brands,
  campaigns,
  invoiceCounters,
  payments,
} from '@settlement/database/schema';
import { calculateAdvertising } from '@settlement/domain/advertising';
import {
  and,
  desc,
  eq,
  getTableColumns,
  sql,
  gte,
  lte,
  lt,
  or,
  like,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { date, id, money, name, revision, rate } from '../validation';
import { advertisingAccount, advertisingAccounts } from './accounts';

const fields = z
  .object({
    brandId: id,
    date,
    period: z.string().trim().min(1).max(120),
    vatBasisPoints: rate.default(1000),
    campaigns: z
      .array(z.object({ name, amount: money }).strict())
      .min(1)
      .max(50),
  })
  .strict();

export const advertisingRoutes = new Hono<AppEnvironment>()
  .get('/', async (context) => {
    const query = z
      .object({
        brandId: id.optional(),
        from: date.optional(),
        to: date.optional(),
        before: date.optional(),
        beforeId: id.optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(context.req.query());
    if (query.from && query.to && query.to < query.from)
      throw new HTTPException(422, { message: 'Choose a valid date range.' });
    const rows = await context
      .get('database')()
      .select({
        id: adInvoices.id,
        brandId: adInvoices.brandId,
        brandName: adInvoices.brandName,
        invoiceNumber: adInvoices.invoiceNumber,
        date: adInvoices.date,
        period: adInvoices.period,
        total: adInvoices.total,
        revision: adInvoices.revision,
      })
      .from(adInvoices)
      .where(
        and(
          query.brandId ? eq(adInvoices.brandId, query.brandId) : undefined,
          query.from ? gte(adInvoices.date, query.from) : undefined,
          query.to ? lte(adInvoices.date, query.to) : undefined,
          query.q
            ? or(
                like(
                  adInvoices.invoiceNumber,
                  `%${query.q.replaceAll('%', '').replaceAll('_', '')}%`,
                ),
                like(
                  adInvoices.period,
                  `%${query.q.replaceAll('%', '').replaceAll('_', '')}%`,
                ),
              )
            : undefined,
          query.before && query.beforeId
            ? or(
                lt(adInvoices.date, query.before),
                and(
                  eq(adInvoices.date, query.before),
                  lt(adInvoices.id, query.beforeId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adInvoices.date), desc(adInvoices.id))
      .limit(21);
    const page = rows.slice(0, 20);
    const accounts = page.length
      ? await advertisingAccounts(context.env.DB, [
          ...new Set(page.map((row) => row.brandId)),
        ])
      : undefined;
    const last = page.at(-1);
    return context.json({
      items: page.map((row) => ({
        ...row,
        paid:
          accounts
            ?.get(row.brandId)
            ?.invoices.find((item) => item.id === row.id)?.paid ?? 0,
      })),
      next:
        rows.length > 20 && last
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .get('/overview', async (context) => {
    const result = await context.env.DB.prepare(
      `WITH invoice_totals AS (
      SELECT brand_id, COUNT(*) AS count, SUM(total) AS total FROM ad_invoices GROUP BY brand_id
    ), direct_totals AS (
      SELECT a.brand_id, SUM(p.amount) AS paid FROM payments p JOIN ad_invoices a ON a.id = p.ad_invoice_id GROUP BY a.brand_id
    ), account_totals AS (
      SELECT brand_id, SUM(amount) AS paid FROM payments WHERE brand_id IS NOT NULL GROUP BY brand_id
    ) SELECT b.id, b.name, COALESCE(i.count, 0) AS count, COALESCE(i.total, 0) AS total,
      COALESCE(d.paid, 0) + COALESCE(a.paid, 0) AS paid
      FROM brands b LEFT JOIN invoice_totals i ON i.brand_id = b.id
      LEFT JOIN direct_totals d ON d.brand_id = b.id LEFT JOIN account_totals a ON a.brand_id = b.id
      ORDER BY b.normalized_name LIMIT 500`,
    ).all<{
      id: string;
      name: string;
      count: number;
      total: number;
      paid: number;
    }>();
    return context.json({ items: result.results });
  })
  .get('/account/:brandId', async (context) => {
    const brandId = id.parse(context.req.param('brandId'));
    const database = context.get('database')();
    const [account, history] = await Promise.all([
      advertisingAccount(context.env.DB, brandId),
      database
        .select({
          id: payments.id,
          amount: payments.amount,
          date: payments.date,
          note: payments.note,
          proofFileId: payments.proofFileId,
        })
        .from(payments)
        .where(eq(payments.brandId, brandId))
        .orderBy(desc(payments.date), desc(payments.id))
        .limit(200),
    ]);
    return context.json({ ...account, payments: history });
  })
  .get('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const database = context.get('database')();
    const [item] = await database
      .select(getTableColumns(adInvoices))
      .from(adInvoices)
      .where(eq(adInvoices.id, key))
      .limit(1);
    if (item === undefined)
      throw new HTTPException(404, {
        message: 'Advertising invoice not found.',
      });
    const [lines, history, account] = await Promise.all([
      database
        .select({ name: campaigns.name, amount: campaigns.amount })
        .from(campaigns)
        .where(eq(campaigns.invoiceId, key))
        .orderBy(campaigns.position)
        .limit(50),
      database
        .select({
          id: payments.id,
          amount: payments.amount,
          date: payments.date,
          note: payments.note,
          proofFileId: payments.proofFileId,
        })
        .from(payments)
        .where(eq(payments.adInvoiceId, key))
        .orderBy(desc(payments.date), desc(payments.id))
        .limit(200),
      advertisingAccount(context.env.DB, item.brandId),
    ]);
    return context.json({
      item: {
        ...item,
        paid: account.invoices.find((invoice) => invoice.id === key)?.paid ?? 0,
        campaigns: lines,
      },
      payments: history,
    });
  })
  .post('/', async (context) => {
    const input = fields.parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const [brand] = await database
      .select({ name: brands.name })
      .from(brands)
      .where(eq(brands.id, input.brandId))
      .limit(1);
    if (brand === undefined)
      throw new HTTPException(422, { message: 'Select an existing brand.' });
    const [counter] = await database
      .insert(invoiceCounters)
      .values({ kind: 'ads', date: input.date, value: 1 })
      .onConflictDoUpdate({
        target: [invoiceCounters.kind, invoiceCounters.date],
        set: { value: sql`${invoiceCounters.value} + 1` },
      })
      .returning({ value: invoiceCounters.value });
    if (counter === undefined) throw new Error('Missing invoice counter.');
    const key = crypto.randomUUID(),
      now = Date.now();
    const binding = context.env.DB;
    const results = await binding.batch([
      binding
        .prepare(
          'INSERT INTO ad_invoices (id, invoice_number, brand_id, brand_name, date, period, normalized_period, total, vat_basis_points, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(brand_id, normalized_period) DO NOTHING RETURNING id',
        )
        .bind(
          key,
          `ADS-${input.date.replaceAll('-', '')}-${String(counter.value).padStart(3, '0')}`,
          input.brandId,
          brand.name,
          input.date,
          input.period,
          input.period.toLocaleLowerCase('en-US'),
          calculateAdvertising(
            input.campaigns.map((line) => line.amount),
            input.vatBasisPoints,
          ).total,
          input.vatBasisPoints,
          now,
          now,
        ),
      ...input.campaigns.map((line, index) =>
        binding
          .prepare(
            'INSERT INTO campaigns (id, invoice_id, position, name, amount) SELECT ?, id, ?, ?, ? FROM ad_invoices WHERE id = ?',
          )
          .bind(crypto.randomUUID(), index, line.name, line.amount, key),
      ),
    ]);
    if (!results[0]?.results.length)
      throw new HTTPException(409, {
        message:
          'An advertising invoice already exists for this brand and period.',
      });
    return context.json({ id: key }, 201);
  })
  .put('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = fields
      .extend({ revision })
      .parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const [current] = await database
      .select({
        brandId: adInvoices.brandId,
        vatBasisPoints: adInvoices.vatBasisPoints,
      })
      .from(adInvoices)
      .where(eq(adInvoices.id, key))
      .limit(1);
    if (current === undefined)
      throw new HTTPException(404, {
        message: 'Advertising invoice not found.',
      });
    if (current.brandId !== input.brandId)
      throw new HTTPException(422, {
        message:
          'The brand of a saved advertising invoice cannot change because payments may already be allocated.',
      });
    if (current.vatBasisPoints !== input.vatBasisPoints)
      throw new HTTPException(409, {
        message: 'Saved VAT rules cannot change. Create a new invoice instead.',
      });
    const [duplicate] = await database
      .select({ id: adInvoices.id })
      .from(adInvoices)
      .where(
        and(
          eq(adInvoices.brandId, input.brandId),
          eq(
            adInvoices.normalizedPeriod,
            input.period.toLocaleLowerCase('en-US'),
          ),
        ),
      )
      .limit(1);
    if (duplicate !== undefined && duplicate.id !== key)
      throw new HTTPException(409, {
        message: 'An invoice already exists for this brand and period.',
      });
    const binding = context.env.DB;
    const results = await binding.batch([
      binding
        .prepare(
          'DELETE FROM campaigns WHERE invoice_id = ? AND EXISTS (SELECT 1 FROM ad_invoices WHERE id = ? AND revision = ?)',
        )
        .bind(key, key, input.revision),
      ...input.campaigns.map((line, index) =>
        binding
          .prepare(
            'INSERT INTO campaigns (id, invoice_id, position, name, amount) SELECT ?, id, ?, ?, ? FROM ad_invoices WHERE id = ? AND revision = ?',
          )
          .bind(
            crypto.randomUUID(),
            index,
            line.name,
            line.amount,
            key,
            input.revision,
          ),
      ),
      binding
        .prepare(
          'UPDATE ad_invoices SET date = ?, period = ?, normalized_period = ?, total = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? RETURNING id',
        )
        .bind(
          input.date,
          input.period,
          input.period.toLocaleLowerCase('en-US'),
          calculateAdvertising(
            input.campaigns.map((line) => line.amount),
            current.vatBasisPoints,
          ).total,
          Date.now(),
          key,
          input.revision,
        ),
    ]);
    if (!results.at(-1)?.results.length)
      throw new HTTPException(409, {
        message: 'This invoice changed. Reload before editing.',
      });
    return context.json({ id: key });
  })
  .delete('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = z
      .object({ revision })
      .strict()
      .parse(await context.req.json<unknown>());
    const [item] = await context
      .get('database')()
      .delete(adInvoices)
      .where(
        and(eq(adInvoices.id, key), eq(adInvoices.revision, input.revision)),
      )
      .returning({ id: adInvoices.id });
    if (item === undefined)
      throw new HTTPException(409, {
        message: 'This invoice changed or was removed. Reload first.',
      });
    return context.json({ ok: true });
  });
