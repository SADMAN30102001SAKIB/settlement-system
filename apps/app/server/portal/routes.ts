import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import {
  settlements,
  adInvoices,
  campaigns,
  settings,
} from '@settlement/database/schema';
import type { AppEnvironment } from '../environment';
import { id, date } from '../validation';
import { documentKind } from '../../shared/access';
import { requireBrand } from './auth';
import { settlementStatus, advertisingStatus } from '../invoice-status/routes';
import { advertisingAccount } from '../advertising/accounts';
import { receiptById } from '../receipts/service';
import { loadPaymentAccount } from '../receipts/account';
import { listAdvances } from '../receipts/advances';

export const portalRoutes = new Hono<AppEnvironment>()
  .use('*', requireBrand)
  .get('/advances', async (c) => {
    const q = z
      .object({ before: date.optional(), beforeId: id.optional() })
      .strict()
      .refine((q) => !!q.before === !!q.beforeId)
      .parse(c.req.query());
    return c.json(
      await listAdvances(c.env.DB, c.get('brandId'), q.before, q.beforeId),
    );
  })
  .get('/payment-summary', async (c) => {
    z.object({}).strict().parse(c.req.query());
    const {
      commission,
      ads,
      commissionBasisPoints,
      advance,
      totalPaid,
      totalReceived,
    } = await loadPaymentAccount(c.env.DB, c.get('brandId'));
    return c.json({
      commission,
      ads,
      commissionBasisPoints,
      advance,
      totalPaid,
      totalReceived,
    });
  })
  .get('/settings', async (c) => {
    const [item] = await c
      .get('database')()
      .select()
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    if (!item)
      throw new HTTPException(404, { message: 'Invoice settings not found.' });
    return c.json({ item });
  })
  .get('/invoices', async (c) => {
    const query = z
      .object({
        kind: documentKind,
        before: date.optional(),
        beforeId: id.optional(),
      })
      .strict()
      .refine((value) => !!value.before === !!value.beforeId, {
        message: 'Invalid invoice cursor.',
      })
      .parse(c.req.query());
    const table =
      query.kind === 'settlements'
        ? 'settlements'
        : query.kind === 'advertising'
          ? 'ad_invoices'
          : 'payment_receipts';
    const number = query.kind === 'receipts' ? 'number' : 'invoice_number';
    const period = query.kind === 'receipts' ? "'Payment receipt'" : 'period';
    const result = await c.env.DB.prepare(
      `SELECT id,${number} AS number,date,${period} AS period FROM ${table} WHERE brand_id=? ${query.before ? 'AND (date<? OR (date=? AND id<?))' : ''} ORDER BY date DESC,id DESC LIMIT 21`,
    )
      .bind(
        c.get('brandId'),
        ...(query.before
          ? [query.before, query.before, query.beforeId ?? '']
          : []),
      )
      .all<{ id: string; number: string; date: string; period: string }>();
    const items = result.results.slice(0, 20),
      last = items.at(-1);
    return c.json({
      items,
      next:
        result.results.length > 20 && last
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .get('/invoices/:kind/:id', async (c) => {
    const kind = documentKind.parse(c.req.param('kind')),
      key = id.parse(c.req.param('id')),
      brandId = c.get('brandId');
    const db = c.get('database')();
    if (kind === 'settlements') {
      const [item] = await db
        .select({
          ...getTableColumns(settlements),
          statusOverride: settlementStatus,
          paid: sql<number>`COALESCE((SELECT SUM(amount) FROM payments WHERE settlement_id=settlements.id),0)`,
        })
        .from(settlements)
        .where(and(eq(settlements.id, key), eq(settlements.brandId, brandId)))
        .limit(1);
      if (!item)
        throw new HTTPException(404, { message: 'Invoice not found.' });
      return c.json({ item });
    }
    if (kind === 'advertising') {
      const [item] = await db
        .select({
          ...getTableColumns(adInvoices),
          statusOverride: advertisingStatus,
        })
        .from(adInvoices)
        .where(and(eq(adInvoices.id, key), eq(adInvoices.brandId, brandId)))
        .limit(1);
      if (!item)
        throw new HTTPException(404, { message: 'Invoice not found.' });
      const [lines, account] = await Promise.all([
        db
          .select({ name: campaigns.name, amount: campaigns.amount })
          .from(campaigns)
          .where(eq(campaigns.invoiceId, key))
          .orderBy(campaigns.position)
          .limit(50),
        advertisingAccount(c.env.DB, brandId),
      ]);
      return c.json({
        item: {
          ...item,
          paid: account.invoices.find((row) => row.id === key)?.paid ?? 0,
          campaigns: lines,
        },
      });
    }
    if (
      !(await c.env.DB.prepare(
        'SELECT id FROM payment_receipts WHERE id=? AND brand_id=?',
      )
        .bind(key, brandId)
        .first())
    )
      throw new HTTPException(404, { message: 'Invoice not found.' });
    return c.json({ item: await receiptById(c.env.DB, key) });
  })
  .get('/files/:id', async (c) => {
    const key = id.parse(c.req.param('id'));
    const file = await c.env.DB.prepare(
      `SELECT object_key AS objectKey,mime FROM files WHERE id=? AND id IN (SELECT watermark_file_id FROM settings WHERE id=1 UNION ALL SELECT signature_file_id FROM settings WHERE id=1 UNION ALL SELECT paid_stamp_file_id FROM settings WHERE id=1 UNION ALL SELECT unpaid_stamp_file_id FROM settings WHERE id=1 UNION ALL SELECT due_stamp_file_id FROM settings WHERE id=1)`,
    )
      .bind(key)
      .first<{ objectKey: string; mime: string }>();
    if (!file) throw new HTTPException(404, { message: 'Image not found.' });
    const object = await c.env.FILES.get(file.objectKey);
    if (!object) throw new HTTPException(404, { message: 'Image not found.' });
    return new Response(object.body, {
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  });
