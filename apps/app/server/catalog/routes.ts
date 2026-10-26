import {
  adInvoices,
  brands,
  notes,
  settings,
  settlements,
} from '@settlement/database/schema';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import type { AppEnvironment } from '../environment';
import { date, id, money, name, rate } from '../validation';

const brandFields = z.object({ name, makingCost: money.nullable() }).strict();
const settingFields = z
  .object({
    companyName: name,
    address: z.string().trim().max(200),
    phone: z.string().trim().max(40),
    email: z.union([z.literal(''), z.email()]),
    signatureLabel: z.string().trim().min(1).max(80),
    agencyBasisPoints: rate,
  })
  .strict();
const noteFields = z
  .object({
    brandId: id,
    period: z.string().trim().min(1).max(120),
    type: z.enum(['Ads Invoice ready', '15% calculated', 'Both done', 'Other']),
    content: z.string().trim().max(1000),
  })
  .strict();

export const catalogRoutes = new Hono<AppEnvironment>()
  .get('/bootstrap', async (context) => {
    const database = context.get('database')();
    const [brandItems, settingItems] = await database.batch([
      database
        .select({
          id: brands.id,
          name: brands.name,
          makingCost: brands.makingCost,
        })
        .from(brands)
        .orderBy(brands.normalizedName)
        .limit(500),
      database.select().from(settings).where(eq(settings.id, 1)).limit(1),
    ]);
    const item = settingItems[0];
    if (item === undefined)
      throw new HTTPException(409, { message: 'Complete admin setup first.' });
    return context.json({ brands: brandItems, settings: item });
  })
  .get('/brands', async (context) => {
    const items = await context
      .get('database')()
      .select({
        id: brands.id,
        name: brands.name,
        makingCost: brands.makingCost,
      })
      .from(brands)
      .orderBy(brands.normalizedName)
      .limit(500);
    return context.json({ items });
  })
  .post('/brands', async (context) => {
    const input = brandFields.parse(await context.req.json<unknown>());
    const now = Date.now();
    const [item] = await context
      .get('database')()
      .insert(brands)
      .values({
        ...input,
        id: crypto.randomUUID(),
        normalizedName: input.name.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: brands.normalizedName })
      .returning({
        id: brands.id,
        name: brands.name,
        makingCost: brands.makingCost,
      });
    if (item === undefined)
      throw new HTTPException(409, {
        message: 'A brand with that name already exists.',
      });
    return context.json({ item }, 201);
  })
  .put('/brands/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = brandFields.parse(await context.req.json<unknown>());
    const database = context.get('database')();
    const [duplicate] = await database
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.normalizedName, input.name.toLowerCase()))
      .limit(1);
    if (duplicate !== undefined && duplicate.id !== key)
      throw new HTTPException(409, {
        message: 'A brand with that name already exists.',
      });
    const [item] = await database
      .update(brands)
      .set({
        ...input,
        normalizedName: input.name.toLowerCase(),
        updatedAt: Date.now(),
      })
      .where(eq(brands.id, key))
      .returning({
        id: brands.id,
        name: brands.name,
        makingCost: brands.makingCost,
      });
    if (item === undefined)
      throw new HTTPException(404, { message: 'Brand not found.' });
    return context.json({ item });
  })
  .get('/settings', async (context) => {
    const [item] = await context
      .get('database')()
      .select()
      .from(settings)
      .where(eq(settings.id, 1))
      .limit(1);
    if (item === undefined)
      throw new HTTPException(409, { message: 'Complete admin setup first.' });
    return context.json({ item });
  })
  .put('/settings', async (context) => {
    const input = settingFields.parse(await context.req.json<unknown>());
    const [item] = await context
      .get('database')()
      .update(settings)
      .set({ ...input, updatedAt: Date.now() })
      .where(eq(settings.id, 1))
      .returning();
    if (item === undefined)
      throw new HTTPException(409, { message: 'Complete admin setup first.' });
    return context.json({ item });
  })
  .post('/settings/reset', async (context) => {
    const [item] = await context
      .get('database')()
      .update(settings)
      .set({
        companyName: 'Hexa Agency Ltd.',
        address: 'Binodpur Bazar, Rajshahi',
        phone: '01404989709',
        email: 'zargon.bd@gmail.com',
        signatureLabel: 'Authorized Signature',
        updatedAt: Date.now(),
      })
      .where(eq(settings.id, 1))
      .returning();
    if (item === undefined)
      throw new HTTPException(409, { message: 'Complete admin setup first.' });
    return context.json({ item });
  })
  .get('/notes', async (context) => {
    const query = z
      .object({
        brandId: id.optional(),
        before: z.coerce.number().int().min(0).optional(),
        beforeId: id.optional(),
      })
      .parse(context.req.query());
    const items = await context
      .get('database')()
      .select({
        id: notes.id,
        brandId: notes.brandId,
        brandName: brands.name,
        period: notes.period,
        type: notes.type,
        content: notes.content,
        createdAt: notes.createdAt,
      })
      .from(notes)
      .innerJoin(brands, eq(brands.id, notes.brandId))
      .where(
        and(
          query.brandId === undefined
            ? undefined
            : eq(notes.brandId, query.brandId),
          query.before === undefined || query.beforeId === undefined
            ? undefined
            : or(
                lt(notes.createdAt, query.before),
                and(
                  eq(notes.createdAt, query.before),
                  lt(notes.id, query.beforeId),
                ),
              ),
        ),
      )
      .orderBy(desc(notes.createdAt), desc(notes.id))
      .limit(201);
    const last = items[199];
    return context.json({
      items: items.slice(0, 200),
      next:
        items.length > 200 && last !== undefined
          ? { before: last.createdAt, beforeId: last.id }
          : null,
    });
  })
  .get('/progress', async (context) => {
    const query = z
      .object({
        kind: z.enum(['settlements', 'advertising']),
        brandId: id.optional(),
        before: date.optional(),
        beforeId: id.optional(),
      })
      .parse(context.req.query());
    const table = query.kind === 'settlements' ? settlements : adInvoices;
    const items = await context
      .get('database')()
      .select({
        id: table.id,
        brandId: table.brandId,
        brandName: table.brandName,
        period: table.period,
        date: table.date,
        invoiceNumber: table.invoiceNumber,
      })
      .from(table)
      .where(
        and(
          query.brandId === undefined
            ? undefined
            : eq(table.brandId, query.brandId),
          query.before === undefined || query.beforeId === undefined
            ? undefined
            : or(
                lt(table.date, query.before),
                and(eq(table.date, query.before), lt(table.id, query.beforeId)),
              ),
        ),
      )
      .orderBy(desc(table.date), desc(table.id))
      .limit(51);
    const last = items[49];
    return context.json({
      items: items.slice(0, 50),
      next:
        items.length > 50 && last !== undefined
          ? { before: last.date, beforeId: last.id }
          : null,
    });
  })
  .post('/notes', async (context) => {
    const input = noteFields.parse(await context.req.json<unknown>());
    const now = Date.now();
    const [item] = await context
      .get('database')()
      .insert(notes)
      .values({
        ...input,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return context.json({ item }, 201);
  })
  .put('/notes/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const input = noteFields.parse(await context.req.json<unknown>());
    const [item] = await context
      .get('database')()
      .update(notes)
      .set({ ...input, updatedAt: Date.now() })
      .where(eq(notes.id, key))
      .returning();
    if (item === undefined)
      throw new HTTPException(404, { message: 'Note not found.' });
    return context.json({ item });
  })
  .delete('/notes/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const [item] = await context
      .get('database')()
      .delete(notes)
      .where(eq(notes.id, key))
      .returning({ id: notes.id });
    if (item === undefined)
      throw new HTTPException(404, { message: 'Note not found.' });
    return context.json({ ok: true });
  });
