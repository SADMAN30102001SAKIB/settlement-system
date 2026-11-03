import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnvironment } from './environment';
import { id, date, revision } from './validation';
import { challanFields } from '../shared/challans';
import { lineTotal } from '../shared/manual-invoices';
const projection =
  'id,brand_id AS brandId,date,quantity_milli AS quantityMilli,unit_cost AS unitCost,total,revision,created_at AS createdAt,updated_at AS updatedAt';
export const challanCursor = z
  .object({ before: date.optional(), beforeId: id.optional() })
  .strict()
  .refine((q) => !!q.before === !!q.beforeId);
export async function listChallans(
  db: D1Database,
  brandId: string,
  cursor: z.infer<typeof challanCursor>,
) {
  const result = await db
    .prepare(
      `SELECT ${projection} FROM delivery_challans WHERE brand_id=? ${cursor.before ? 'AND (date,id)<(?,?)' : ''} ORDER BY date DESC,id DESC LIMIT 21`,
    )
    .bind(
      brandId,
      ...(cursor.before ? [cursor.before, cursor.beforeId ?? ''] : []),
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
export const challanRoutes = new Hono<AppEnvironment>()
  .get('/', async (c) => {
    const { brandId, ...cursor } = challanCursor
      .safeExtend({ brandId: id })
      .parse(c.req.query());
    return c.json(await listChallans(c.env.DB, brandId, cursor));
  })
  .post('/', async (c) => {
    const input = challanFields
      .extend({ requestId: id, brandId: id })
      .parse(await c.req.json<unknown>());
    if (
      !(await c.env.DB.prepare('SELECT id FROM brands WHERE id=?')
        .bind(input.brandId)
        .first())
    )
      throw new HTTPException(404, { message: 'Brand not found.' });
    const total = lineTotal({
        quantityMilli: input.quantityMilli,
        price: input.unitCost,
      }),
      now = Date.now();
    await c.env.DB.prepare(
      'INSERT INTO delivery_challans(id,brand_id,date,quantity_milli,unit_cost,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        input.requestId,
        input.brandId,
        input.date,
        input.quantityMilli,
        input.unitCost,
        total,
        now,
        now,
      )
      .run();
    const item = await c.env.DB.prepare(
      `SELECT ${projection} FROM delivery_challans WHERE id=?`,
    )
      .bind(input.requestId)
      .first<{
        brandId: string;
        date: string;
        quantityMilli: number;
        unitCost: number;
      }>();
    if (
      item?.brandId !== input.brandId ||
      item.date !== input.date ||
      item.quantityMilli !== input.quantityMilli ||
      item.unitCost !== input.unitCost
    )
      throw new HTTPException(409, {
        message:
          'This challan request was already used. Reload before creating another.',
      });
    return c.json({ item }, 201);
  })
  .put('/:id', async (c) => {
    const input = challanFields
      .extend({ revision })
      .parse(await c.req.json<unknown>());
    const total = lineTotal({
      quantityMilli: input.quantityMilli,
      price: input.unitCost,
    });
    const item = await c.env.DB.prepare(
      `UPDATE delivery_challans SET date=?,quantity_milli=?,unit_cost=?,total=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING ${projection}`,
    )
      .bind(
        input.date,
        input.quantityMilli,
        input.unitCost,
        total,
        Date.now(),
        id.parse(c.req.param('id')),
        input.revision,
      )
      .first();
    if (!item)
      throw new HTTPException(409, {
        message: 'This challan changed or was deleted. Reload before editing.',
      });
    return c.json({ item });
  })
  .delete('/:id', async (c) => {
    const input = z
      .object({ revision })
      .strict()
      .parse(await c.req.json<unknown>());
    const item = await c.env.DB.prepare(
      'DELETE FROM delivery_challans WHERE id=? AND revision=? RETURNING id',
    )
      .bind(id.parse(c.req.param('id')), input.revision)
      .first();
    if (!item)
      throw new HTTPException(409, {
        message: 'This challan changed or was deleted. Reload before deleting.',
      });
    return c.json({ ok: true });
  });
