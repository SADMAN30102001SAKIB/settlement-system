import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { date, id, money } from '../validation';
import type { AppEnvironment } from '../environment';
import { requestHash } from './service';

export async function listAdvances(
  db: D1Database,
  brandId: string,
  before?: string,
  beforeId?: string,
) {
  const result = await db
    .prepare(
      `SELECT id,date,amount,method,reference,note,reversed_at AS reversedAt,reversal_reason AS reversalReason FROM brand_advances
    WHERE brand_id=? ${before && beforeId ? 'AND (date<? OR (date=? AND id<?))' : ''} ORDER BY date DESC,id DESC LIMIT 21`,
    )
    .bind(
      ...(before && beforeId ? [brandId, before, before, beforeId] : [brandId]),
    )
    .all<{ id: string; date: string }>();
  const items = result.results.slice(0, 20),
    last = items.at(-1);
  return {
    items,
    next:
      result.results.length > 20 && last
        ? { before: last.date, beforeId: last.id }
        : null,
  };
}
export const advanceRoutes = new Hono<AppEnvironment>()
  .delete('/:id', async (c) => {
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({ version: z.number().int().nonnegative() })
      .strict()
      .parse(await c.req.json<unknown>());
    const row = await c.env.DB.prepare(
      `SELECT a.brand_id AS brandId,a.amount,a.reversed_at AS reversedAt,b.payment_version AS version,
      (SELECT COALESCE(SUM(amount),0) FROM brand_advances WHERE brand_id=a.brand_id AND reversed_at IS NULL)
      -(SELECT COALESCE(SUM(advance_amount),0) FROM payment_receipts WHERE brand_id=a.brand_id AND reversed_at IS NULL) AS available
      FROM brand_advances a JOIN brands b ON b.id=a.brand_id WHERE a.id=?`,
    )
      .bind(key)
      .first<{
        brandId: string;
        amount: number;
        reversedAt: number | null;
        version: number;
        available: number;
      }>();
    if (!row) {
      if (
        await c.env.DB.prepare(
          'SELECT id FROM deleted_advance_requests WHERE id=?',
        )
          .bind(key)
          .first()
      )
        return c.json({ ok: true });
      throw new HTTPException(404, { message: 'Advance not found.' });
    }
    if (row.version !== input.version)
      throw new HTTPException(409, {
        message:
          'This account changed. Reload balances before deleting the advance.',
      });
    if (row.reversedAt === null && row.amount > row.available) {
      const receipts = await c.env.DB.prepare(
        'SELECT number FROM payment_receipts WHERE brand_id=? AND advance_amount>0 AND reversed_at IS NULL ORDER BY date DESC,id DESC LIMIT 11',
      )
        .bind(row.brandId)
        .all<{ number: string }>();
      throw new HTTPException(409, {
        message: `This advance cannot be deleted because there is insufficient unused credit. Advance credit is pooled for this brand. Reverse enough credit-payment receipts first: ${receipts.results
          .slice(0, 10)
          .map((r) => r.number)
          .join(
            ', ',
          )}${receipts.results.length > 10 ? ' (more in Payment receipts)' : ''}. Then reload balances and retry.`,
      });
    }
    const deleted = await c.env.DB.prepare(
      'DELETE FROM brand_advances WHERE id=? AND (SELECT payment_version FROM brands WHERE id=brand_id)=? RETURNING id',
    )
      .bind(key, input.version)
      .first();
    if (!deleted)
      throw new HTTPException(409, {
        message:
          'This account changed. Reload balances before deleting the advance.',
      });
    return c.json({ ok: true });
  })
  .get('/', async (c) => {
    const q = z
      .object({ brandId: id, before: date.optional(), beforeId: id.optional() })
      .strict()
      .refine((q) => !!q.before === !!q.beforeId)
      .parse(c.req.query());
    return c.json(
      await listAdvances(c.env.DB, q.brandId, q.before, q.beforeId),
    );
  })
  .post('/', async (c) => {
    const input = z
      .object({
        requestId: id,
        brandId: id,
        date,
        amount: money.refine((n) => n > 0 && n % 10 === 0),
        method: z.enum(['Cash', 'Bank transfer', 'bKash', 'Nagad', 'Other']),
        reference: z.string().trim().max(100),
        note: z.string().trim().max(200),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const hash = await requestHash(input);
    if (
      !(await c.env.DB.prepare('SELECT id FROM brands WHERE id=?')
        .bind(input.brandId)
        .first())
    )
      throw new HTTPException(404, { message: 'Brand not found.' });
    await c.env.DB.prepare(
      'INSERT INTO brand_advances (id,brand_id,date,amount,method,reference,note,request_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        input.requestId,
        input.brandId,
        input.date,
        input.amount,
        input.method,
        input.reference,
        input.note,
        hash,
        Date.now(),
      )
      .run();
    const existing = await c.env.DB.prepare(
      'SELECT request_hash AS hash FROM brand_advances WHERE id=?',
    )
      .bind(input.requestId)
      .first<{ hash: string }>();
    if (existing?.hash !== hash)
      throw new HTTPException(409, {
        message: 'This advance request was already used for different details.',
      });
    return c.json({ ok: true });
  })
  .post('/:id/reverse', async (c) => {
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({
        version: z.number().int().nonnegative(),
        reason: z.string().trim().min(5).max(200),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const row = await c.env.DB.prepare(
      'SELECT reversed_at AS reversedAt FROM brand_advances WHERE id=?',
    )
      .bind(key)
      .first<{ reversedAt: number | null }>();
    if (!row) throw new HTTPException(404, { message: 'Advance not found.' });
    if (row.reversedAt !== null) return c.json({ ok: true });
    const updated = await c.env.DB.prepare(
      'UPDATE brand_advances SET reversed_at=?,reversal_reason=? WHERE id=? AND reversed_at IS NULL AND (SELECT payment_version FROM brands WHERE id=brand_id)=? RETURNING id',
    )
      .bind(Date.now(), input.reason, key, input.version)
      .first();
    if (!updated)
      throw new HTTPException(409, {
        message:
          'This account changed. Reload balances before reversing the advance.',
      });
    return c.json({ ok: true });
  });
