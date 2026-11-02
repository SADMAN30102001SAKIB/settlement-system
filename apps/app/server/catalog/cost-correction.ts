import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnvironment } from '../environment';
import { z } from 'zod';
import { date, id, money, name } from '../validation';
import { digest } from '../auth/crypto';

const fields = z
  .object({ name, makingCost: money, from: date, to: date })
  .strict()
  .refine((input) => input.from <= input.to, {
    message: 'Choose a valid date range.',
  });
type Input = z.infer<typeof fields>;

export async function previewCostCorrection(
  db: D1Database,
  brandId: string,
  input: Input,
) {
  const brand = await db
    .prepare(
      'SELECT id,name,making_cost AS makingCost,updated_at AS updatedAt FROM brands WHERE id=?',
    )
    .bind(brandId)
    .first<{
      id: string;
      name: string;
      makingCost: number | null;
      updatedAt: number;
    }>();
  if (!brand) throw new HTTPException(404, { message: 'Brand not found.' });
  const result = await db
    .prepare(
      `SELECT id,revision,cost_per_piece AS cost,quantity,status FROM orders
    WHERE brand_id=? AND order_date>=? AND order_date<=? AND cost_per_piece IS NOT ? ORDER BY order_date,id LIMIT 2001`,
    )
    .bind(brandId, input.from, input.to, input.makingCost)
    .all<{
      id: string;
      revision: number;
      cost: number | null;
      quantity: number;
      status: string;
    }>();
  if (result.results.length > 2000)
    throw new HTTPException(422, {
      message: 'More than 2,000 orders match. Choose a smaller date range.',
    });
  const snapshot = {
    brand,
    normalizedName: input.name.toLowerCase(),
    orders: result.results,
  };
  const version = await digest(JSON.stringify({ input, snapshot }));
  let before = 0,
    after = 0,
    deliveredUnits = 0;
  for (const row of snapshot.orders)
    if (row.status === 'Delivered') {
      deliveredUnits += row.quantity;
      before += (row.cost ?? 0) * row.quantity;
      after += input.makingCost * row.quantity;
    }
  money.parse(before);
  money.parse(after);
  return {
    snapshot,
    version,
    count: snapshot.orders.length,
    deliveredUnits,
    before,
    after,
  };
}

export const costCorrectionRoutes = new Hono<AppEnvironment>()
  .post('/:id/preview', async (c) => {
    const input = fields.parse(await c.req.json<unknown>());
    const preview = await previewCostCorrection(
      c.env.DB,
      id.parse(c.req.param('id')),
      input,
    );
    return c.json({
      version: preview.version,
      count: preview.count,
      deliveredUnits: preview.deliveredUnits,
      before: preview.before,
      after: preview.after,
    });
  })
  .post('/:id', async (c) => {
    const brandId = id.parse(c.req.param('id'));
    const { requestId, version, ...input } = fields
      .safeExtend({
        requestId: id,
        version: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(await c.req.json<unknown>());
    const previous = await c.env.DB.prepare(
      'SELECT brand_id AS brandId,name,making_cost AS makingCost,from_date AS fromDate,to_date AS toDate,version FROM order_cost_corrections WHERE id=?',
    )
      .bind(requestId)
      .first<{
        brandId: string;
        name: string;
        makingCost: number;
        fromDate: string;
        toDate: string;
        version: string;
      }>();
    if (previous) {
      if (
        previous.brandId !== brandId ||
        previous.name !== input.name ||
        previous.makingCost !== input.makingCost ||
        previous.fromDate !== input.from ||
        previous.toDate !== input.to ||
        previous.version !== version
      )
        throw new HTTPException(409, {
          message: 'This correction request was already used. Preview again.',
        });
      return c.json({ ok: true });
    }
    const preview = await previewCostCorrection(c.env.DB, brandId, input);
    if (preview.version !== version)
      throw new HTTPException(409, {
        message:
          'The brand or its orders changed. Preview again before applying.',
      });
    try {
      await c.env.DB.prepare(
        `INSERT INTO order_cost_corrections (id,brand_id,name,making_cost,from_date,to_date,version,snapshot,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          requestId,
          brandId,
          input.name,
          input.makingCost,
          input.from,
          input.to,
          version,
          JSON.stringify(preview.snapshot),
          c.get('username'),
          Date.now(),
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        /COST_CORRECTION_STALE|UNIQUE constraint/.test(error.message)
      )
        throw new HTTPException(409, {
          message:
            'The brand or its orders changed, or the name is already in use. Preview again.',
        });
      throw error;
    }
    return c.json({ ok: true });
  });
