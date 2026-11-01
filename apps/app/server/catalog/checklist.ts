import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnvironment } from '../environment';
import { date, id } from '../validation';
import { checklistTask } from '../../shared/checklist';

interface State {
  ordersDone: number;
  adsDone: number;
  revision: number;
}
const projection =
  'COALESCE(t.orders_done,0) AS ordersDone,COALESCE(t.ads_done,0) AS adsDone,COALESCE(t.revision,0) AS revision';
const publicState = (row: State) => ({
  ordersDone: !!row.ordersDone,
  adsDone: !!row.adsDone,
  revision: row.revision,
});

export const checklistRoutes = new Hono<AppEnvironment>()
  .get('/', async (c) => {
    const query = z
      .object({ date, after: z.string().max(80).optional() })
      .strict()
      .parse(c.req.query());
    const result = await c.env.DB.prepare(
      `SELECT b.id,b.name,${projection} FROM brands b LEFT JOIN daily_tasks t ON t.date=? AND t.brand_id=b.id
       ${query.after ? 'WHERE b.normalized_name>?' : ''} ORDER BY b.normalized_name LIMIT 21`,
    )
      .bind(query.date, ...(query.after ? [query.after] : []))
      .all<State & { id: string; name: string }>();
    const items = result.results
      .slice(0, 20)
      .map((row) => ({ id: row.id, name: row.name, ...publicState(row) }));
    const last = items.at(-1);
    return c.json({
      items,
      next:
        result.results.length > 20 && last
          ? { after: last.name.toLowerCase() }
          : null,
    });
  })
  .get('/:id', async (c) => {
    const brandId = id.parse(c.req.param('id'));
    const query = z.object({ date }).strict().parse(c.req.query());
    const row = await c.env.DB.prepare(
      `SELECT ${projection} FROM brands b LEFT JOIN daily_tasks t ON t.date=? AND t.brand_id=b.id WHERE b.id=?`,
    )
      .bind(query.date, brandId)
      .first<State>();
    if (!row) throw new HTTPException(404, { message: 'Brand not found.' });
    return c.json({ item: publicState(row) });
  })
  .patch('/:id', async (c) => {
    const brandId = id.parse(c.req.param('id'));
    const input = z
      .object({
        date,
        task: checklistTask,
        done: z.boolean(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const returning = 'orders_done AS ordersDone,ads_done AS adsDone,revision';
    const column = input.task === 'ordersDone' ? 'orders_done' : 'ads_done';
    const row =
      input.revision === 0
        ? await c.env.DB.prepare(
            `INSERT INTO daily_tasks (date,brand_id,orders_done,ads_done,revision,updated_at)
           SELECT ?,id,?,?,1,? FROM brands WHERE id=? ON CONFLICT(date,brand_id) DO NOTHING RETURNING ${returning}`,
          )
            .bind(
              input.date,
              input.task === 'ordersDone' && input.done ? 1 : 0,
              input.task === 'adsDone' && input.done ? 1 : 0,
              Date.now(),
              brandId,
            )
            .first<State>()
        : await c.env.DB.prepare(
            `UPDATE daily_tasks SET ${column}=?,revision=revision+1,updated_at=? WHERE date=? AND brand_id=? AND revision=? RETURNING ${returning}`,
          )
            .bind(
              input.done ? 1 : 0,
              Date.now(),
              input.date,
              brandId,
              input.revision,
            )
            .first<State>();
    if (!row) {
      const exists = await c.env.DB.prepare('SELECT id FROM brands WHERE id=?')
        .bind(brandId)
        .first();
      throw new HTTPException(exists ? 409 : 404, {
        message: exists
          ? 'This checklist changed elsewhere. Review the latest checkmarks and retry.'
          : 'Brand not found.',
      });
    }
    return c.json({ item: publicState(row) });
  });
