import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnvironment } from './environment';
import { id, date, revision } from './validation';
import {
  manualFields,
  manualSchema,
  manualTotal,
  companySchema,
} from '../shared/manual-invoices';
async function read(db: D1Database, key: string) {
  const row = await db
    .prepare(
      'SELECT id,number,date,title,recipient,data,total,revision FROM manual_invoices WHERE id=?',
    )
    .bind(key)
    .first();
  if (!row) return null;
  const { data, ...metadata } = row;
  return manualSchema.parse({
    ...z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(z.string().parse(data))),
    ...metadata,
  });
}
export const manualRoutes = new Hono<AppEnvironment>()
  .get('/', async (c) => {
    const q = z
      .object({ before: date.optional(), beforeId: id.optional() })
      .strict()
      .refine((q) => !!q.before === !!q.beforeId)
      .parse(c.req.query());
    const result = await c.env.DB.prepare(
      `SELECT id,number,date,title,recipient,total,revision FROM manual_invoices ${q.before && q.beforeId ? 'WHERE date<? OR (date=? AND id<?)' : ''} ORDER BY date DESC,id DESC LIMIT 21`,
    )
      .bind(...(q.before && q.beforeId ? [q.before, q.before, q.beforeId] : []))
      .all<{ id: string; date: string }>();
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
  .get('/:id', async (c) => {
    const item = await read(c.env.DB, id.parse(c.req.param('id')));
    if (!item)
      throw new HTTPException(404, { message: 'Manual invoice not found.' });
    return c.json({ item });
  })
  .post('/', async (c) => {
    const { requestId, ...input } = manualFields
      .safeExtend({ requestId: id })
      .parse(await c.req.json<unknown>());
    const existing = await read(c.env.DB, requestId);
    if (existing) {
      if (
        JSON.stringify(manualFields.strip().parse(existing)) !==
        JSON.stringify(input)
      )
        throw new HTTPException(409, {
          message:
            'This invoice request was already used. Reload before creating a different invoice.',
        });
      return c.json({ item: existing });
    }
    const total = manualTotal(input.lines);
    const company = companySchema.parse(
      await c.env.DB.prepare(
        'SELECT company_name AS companyName,address,phone,email FROM settings WHERE id=1',
      ).first(),
    );
    const counter = await c.env.DB.prepare(
      "INSERT INTO invoice_counters(kind,date,value) VALUES ('manual',?,1) ON CONFLICT(kind,date) DO UPDATE SET value=value+1 RETURNING value",
    )
      .bind(input.date)
      .first<{ value: number }>();
    if (!counter) throw new Error('Missing invoice counter.');
    const number = `MAN-${input.date.replaceAll('-', '')}-${String(counter.value).padStart(4, '0')}`;
    await c.env.DB.prepare(
      'INSERT INTO manual_invoices(id,number,date,title,recipient,data,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
      .bind(
        requestId,
        number,
        input.date,
        input.title,
        input.recipient,
        JSON.stringify({ ...input, company }),
        total,
        Date.now(),
        Date.now(),
      )
      .run();
    const saved = await read(c.env.DB, requestId);
    if (
      !saved ||
      JSON.stringify(manualFields.strip().parse(saved)) !==
        JSON.stringify(input)
    )
      throw new HTTPException(409, {
        message: 'This invoice request was already used for different details.',
      });
    return c.json({ item: saved }, 201);
  })
  .put('/:id', async (c) => {
    const key = id.parse(c.req.param('id'));
    const { revision: expected, ...input } = manualFields
      .safeExtend({ revision })
      .parse(await c.req.json<unknown>());
    const saved = await read(c.env.DB, key);
    if (!saved)
      throw new HTTPException(404, { message: 'Manual invoice not found.' });
    const total = manualTotal(input.lines);
    const updated = await c.env.DB.prepare(
      'UPDATE manual_invoices SET date=?,title=?,recipient=?,data=?,total=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING id',
    )
      .bind(
        input.date,
        input.title,
        input.recipient,
        JSON.stringify({ ...input, company: saved.company }),
        total,
        Date.now(),
        key,
        expected,
      )
      .first();
    if (!updated)
      throw new HTTPException(409, {
        message: 'This invoice changed. Reload before editing.',
      });
    return c.json({ item: await read(c.env.DB, key) });
  })
  .delete('/:id', async (c) => {
    const input = z
      .object({ revision })
      .strict()
      .parse(await c.req.json<unknown>());
    const deleted = await c.env.DB.prepare(
      'DELETE FROM manual_invoices WHERE id=? AND revision=? RETURNING id',
    )
      .bind(id.parse(c.req.param('id')), input.revision)
      .first();
    if (!deleted)
      throw new HTTPException(409, {
        message: 'This invoice changed or was deleted. Reload before deleting.',
      });
    return c.json({ ok: true });
  });
