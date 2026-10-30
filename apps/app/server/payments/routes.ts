import {
  adInvoices,
  brands,
  files,
  payments,
  settlements,
} from '@settlement/database/schema';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { date, id, money } from '../validation';

const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('settlement'), targetId: id }),
  z.object({ kind: z.literal('ads'), targetId: id }),
  z.object({ kind: z.literal('brand'), targetId: id }),
]);
const inputSchema = z
  .object({
    requestId: id,
    proofFileId: id.nullable().default(null),
    target,
    amount: money.refine((amount) => amount > 0 && amount % 10 === 0, {
      message: 'Payment must be positive and have at most 2 decimal places.',
    }),
    date,
    note: z.string().trim().max(200),
  })
  .strict();

export const paymentRoutes = new Hono<AppEnvironment>()
  .get('/', async (context) => {
    const query = z
      .object({
        kind: z.enum(['settlement', 'ads', 'brand']),
        targetId: id,
        before: date,
        beforeId: id,
      })
      .parse(context.req.query());
    const column =
      query.kind === 'settlement'
        ? payments.settlementId
        : query.kind === 'ads'
          ? payments.adInvoiceId
          : payments.brandId;
    const items = await context
      .get('database')()
      .select({
        id: payments.id,
        amount: payments.amount,
        date: payments.date,
        note: payments.note,
        proofFileId: payments.proofFileId,
        receiptId: payments.receiptId,
      })
      .from(payments)
      .where(
        and(
          query.kind === 'brand'
            ? or(
                eq(column, query.targetId),
                sql`${payments.adInvoiceId} IN (SELECT id FROM ad_invoices WHERE brand_id=${query.targetId})`,
              )
            : eq(column, query.targetId),
          or(
            lt(payments.date, query.before),
            and(
              eq(payments.date, query.before),
              lt(payments.id, query.beforeId),
            ),
          ),
        ),
      )
      .orderBy(desc(payments.date), desc(payments.id))
      .limit(21);
    return context.json({
      items: items.slice(0, 20),
      hasMore: items.length > 20,
    });
  })
  .post('/', async (context) => {
    const input = inputSchema.parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const table =
      input.target.kind === 'settlement'
        ? settlements
        : input.target.kind === 'ads'
          ? adInvoices
          : brands;
    const [existing] = await database
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, input.target.targetId))
      .limit(1);
    if (existing === undefined)
      throw new HTTPException(404, { message: 'Payment target not found.' });
    if (input.proofFileId !== null) {
      const [proof] = await database
        .select({ kind: files.kind })
        .from(files)
        .where(eq(files.id, input.proofFileId))
        .limit(1);
      if (proof?.kind !== 'proof')
        throw new HTTPException(422, {
          message: 'Select an uploaded payment proof.',
        });
    }
    const destination = {
      settlementId:
        input.target.kind === 'settlement' ? input.target.targetId : null,
      adInvoiceId: input.target.kind === 'ads' ? input.target.targetId : null,
      brandId: input.target.kind === 'brand' ? input.target.targetId : null,
    };
    const [item] = await database
      .insert(payments)
      .values({
        id: input.requestId,
        ...destination,
        proofFileId: input.proofFileId,
        amount: input.amount,
        date: input.date,
        note: input.note,
        createdAt: Date.now(),
      })
      .onConflictDoNothing({ target: payments.id })
      .returning();
    if (item !== undefined) return context.json({ item }, 201);
    const [existingPayment] = await database
      .select()
      .from(payments)
      .where(eq(payments.id, input.requestId))
      .limit(1);
    if (existingPayment === undefined)
      throw new HTTPException(409, {
        message:
          'This payment was removed. Refresh payments before trying again.',
      });
    if (
      existingPayment.settlementId !== destination.settlementId ||
      existingPayment.adInvoiceId !== destination.adInvoiceId ||
      existingPayment.brandId !== destination.brandId ||
      existingPayment.amount !== input.amount ||
      existingPayment.date !== input.date ||
      existingPayment.note !== input.note ||
      existingPayment.proofFileId !== input.proofFileId
    ) {
      throw new HTTPException(409, {
        message:
          'This payment request was already used. Refresh payments before recording a different payment.',
      });
    }
    return context.json({ item: existingPayment });
  })
  .put('/:id/proof', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = z
      .object({ proofFileId: id.nullable() })
      .strict()
      .parse(await context.req.json<unknown>());
    const database = context.get('database')();
    if (input.proofFileId !== null) {
      const [file] = await database
        .select({ kind: files.kind })
        .from(files)
        .where(eq(files.id, input.proofFileId))
        .limit(1);
      if (file?.kind !== 'proof')
        throw new HTTPException(422, {
          message: 'Select an uploaded payment proof.',
        });
    }
    const linked = await context.env.DB.prepare(
      'SELECT receipt_id AS receiptId FROM payments WHERE id=?',
    )
      .bind(key)
      .first<{ receiptId: string | null }>();
    if (linked?.receiptId) {
      await context.env.DB.batch([
        context.env.DB.prepare(
          'UPDATE payment_receipts SET proof_file_id=? WHERE id=?',
        ).bind(input.proofFileId, linked.receiptId),
        context.env.DB.prepare(
          'UPDATE payments SET proof_file_id=? WHERE receipt_id=?',
        ).bind(input.proofFileId, linked.receiptId),
      ]);
      return context.json({ ok: true });
    }
    const [item] = await database
      .update(payments)
      .set({ proofFileId: input.proofFileId })
      .where(eq(payments.id, key))
      .returning({ id: payments.id });
    if (item === undefined)
      throw new HTTPException(404, { message: 'Payment not found.' });
    return context.json({ ok: true });
  })
  .delete('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const [item] = await context
      .get('database')()
      .delete(payments)
      .where(eq(payments.id, key))
      .returning({ id: payments.id });
    if (item === undefined)
      throw new HTTPException(404, { message: 'Payment not found.' });
    return context.json({ ok: true });
  });
