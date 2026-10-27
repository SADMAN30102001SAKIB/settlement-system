import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnvironment } from '../environment';
import { date, id, money } from '../validation';
import { loadPaymentAccount } from './account';
import { stampStatusSchema } from '../../shared/invoice-status';
import {
  createReceipt,
  existingReceipt,
  receiptById,
  receiptInput,
  requestHash,
} from './service';

export const receiptRoutes = new Hono<AppEnvironment>()
  .get('/legacy', async (c) => {
    const q = z
      .object({ brandId: id, before: date.optional(), beforeId: id.optional() })
      .parse(c.req.query());
    const cursor =
      q.before && q.beforeId ? 'WHERE date < ? OR (date = ? AND id < ?)' : '';
    const result = await c.env.DB.prepare(
      `SELECT * FROM (
      SELECT p.id,p.date,p.amount,p.note,'Commission' AS category,s.invoice_number AS invoiceNumber FROM settlements s
      JOIN payments p ON p.settlement_id=s.id WHERE s.brand_id=? AND p.receipt_id IS NULL
      UNION ALL SELECT p.id,p.date,p.amount,p.note,'Advertising',a.invoice_number FROM ad_invoices a
      JOIN payments p ON p.ad_invoice_id=a.id WHERE a.brand_id=? AND p.receipt_id IS NULL
      UNION ALL SELECT id,date,amount,note,'Advertising account','Legacy account payment' FROM payments
      WHERE brand_id=? AND receipt_id IS NULL) ${cursor} ORDER BY date DESC,id DESC LIMIT 21`,
    )
      .bind(
        ...(q.before && q.beforeId
          ? [q.brandId, q.brandId, q.brandId, q.before, q.before, q.beforeId]
          : [q.brandId, q.brandId, q.brandId]),
      )
      .all<{
        id: string;
        date: string;
        amount: number;
        note: string;
        category: string;
        invoiceNumber: string;
      }>();
    const page = result.results.slice(0, 20),
      last = page.at(-1);
    return c.json({
      items: page,
      next:
        result.results.length > 20 && last
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .get('/account/:id', async (c) =>
    c.json(await loadPaymentAccount(c.env.DB, id.parse(c.req.param('id')))),
  )
  .get('/', async (c) => {
    const query = z
      .object({ brandId: id, before: date.optional(), beforeId: id.optional() })
      .parse(c.req.query());
    const rows = await c.env.DB.prepare(
      `SELECT id,date FROM payment_receipts WHERE brand_id=?
      ${query.before && query.beforeId ? 'AND (date < ? OR (date = ? AND id < ?))' : ''}
      ORDER BY date DESC,id DESC LIMIT 21`,
    )
      .bind(
        ...(query.before && query.beforeId
          ? [query.brandId, query.before, query.before, query.beforeId]
          : [query.brandId]),
      )
      .all<{ id: string; date: string }>();
    const page = rows.results.slice(0, 20),
      last = page.at(-1);
    // Receipt snapshots are bounded; fetch the page together rather than one request per receipt.
    const records = page.length
      ? await c.env.DB.prepare(
          `SELECT id,number,brand_id AS brandId,date,total,proof_file_id AS proofFileId,
      created_at AS createdAt,reversed_at AS reversedAt,reversal_reason AS reversalReason,stamp_status AS stampStatus,data FROM payment_receipts
      WHERE id IN (SELECT value FROM json_each(?)) ORDER BY date DESC,id DESC`,
        )
          .bind(JSON.stringify(page.map((r) => r.id)))
          .all()
      : { results: [] };
    const items = records.results.map((row) => ({
      ...row,
      data: JSON.parse(z.string().parse(row['data'])) as unknown,
    }));
    return c.json({
      items,
      next:
        rows.results.length > 20 && last
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .get('/:id', async (c) => {
    const item = await receiptById(c.env.DB, id.parse(c.req.param('id')));
    if (!item)
      throw new HTTPException(404, { message: 'Payment receipt not found.' });
    return c.json({ item });
  })
  .put('/:id/stamp', async (c) => {
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({ status: stampStatusSchema })
      .strict()
      .parse(await c.req.json<unknown>());
    const row = await c.env.DB.prepare(
      'UPDATE payment_receipts SET stamp_status=? WHERE id=? AND reversed_at IS NULL RETURNING id',
    )
      .bind(input.status, key)
      .first();
    if (!row)
      throw new HTTPException(409, {
        message:
          'Receipt not found or already reversed. Reversed receipts cannot be changed.',
      });
    return c.json({ ok: true });
  })
  .post('/', async (c) => {
    const input = receiptInput.parse(await c.req.json<unknown>());
    const hash = await requestHash({ ...input, version: undefined });
    return c.json({ item: await createReceipt(c.env.DB, input, hash) }, 201);
  })
  .post('/from-payment', async (c) => {
    const input = z
      .object({
        requestId: id,
        target: z
          .object({
            kind: z.enum(['settlement', 'ads', 'brand']),
            targetId: id,
          })
          .strict(),
        amount: money.refine((n) => n > 0 && n % 10 === 0),
        date,
        note: z.string().trim().max(200),
        proofFileId: id.nullable(),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const hash = await requestHash(input);
    const existing = await existingReceipt(c.env.DB, input.requestId, hash);
    if (existing) return c.json({ item: existing });
    let brandId = input.target.targetId;
    if (input.target.kind !== 'brand') {
      const table =
        input.target.kind === 'settlement' ? 'settlements' : 'ad_invoices';
      const owner = await c.env.DB.prepare(
        `SELECT brand_id AS brandId FROM ${table} WHERE id=?`,
      )
        .bind(input.target.targetId)
        .first<{ brandId: string }>();
      if (!owner)
        throw new HTTPException(404, { message: 'Invoice not found.' });
      brandId = owner.brandId;
    }
    const account = await loadPaymentAccount(c.env.DB, brandId);
    let remaining = input.amount;
    const allocations = [];
    for (const invoice of account.invoices
      .filter((row) =>
        input.target.kind === 'brand'
          ? row.kind === 'ads'
          : row.id === input.target.targetId &&
            row.kind ===
              (input.target.kind === 'settlement' ? 'commission' : 'ads'),
      )
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      )) {
      const amount = Math.min(invoice.due, remaining);
      if (amount > 0) {
        allocations.push({ kind: invoice.kind, invoiceId: invoice.id, amount });
        remaining -= amount;
      }
    }
    if (remaining > 0)
      throw new HTTPException(422, {
        message:
          'Payment exceeds the outstanding balance. New receipts cannot silently create an advance.',
      });
    const receipt = receiptInput.parse({
      requestId: input.requestId,
      date: input.date,
      note: input.note,
      proofFileId: input.proofFileId,
      brandId,
      version: account.version,
      method: 'Other',
      reference: '',
      allocations,
    });
    return c.json({ item: await createReceipt(c.env.DB, receipt, hash) }, 201);
  })
  .post('/:id/reverse', async (c) => {
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({
        reason: z.string().trim().min(5).max(200),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const receipt = await receiptById(c.env.DB, key);
    if (!receipt)
      throw new HTTPException(404, { message: 'Receipt not found.' });
    if (receipt.reversedAt !== null) return c.json({ ok: true });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE payment_receipts SET reversed_at=CASE WHEN reversed_at IS NULL AND
        (SELECT payment_version FROM brands WHERE id=brand_id)=? THEN ? ELSE -1 END,reversal_reason=? WHERE id=?`,
      ).bind(input.version, Date.now(), input.reason, key),
      c.env.DB.prepare('DELETE FROM payments WHERE receipt_id=?').bind(key),
    ]);
    return c.json({ ok: true });
  });
