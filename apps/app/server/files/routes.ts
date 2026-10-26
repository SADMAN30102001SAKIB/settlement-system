import { files, settings } from '@settlement/database/schema';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnvironment } from '../environment';
import { id } from '../validation';
import defaultImages from './default-images.json';

async function storeImage(
  context: Context<AppEnvironment>,
  kind: 'proof' | 'watermark' | 'signature',
  filename: string,
  data: ArrayBuffer,
) {
  const mime = imageMime(new Uint8Array(data));
  const key = crypto.randomUUID();
  const objectKey = `images/${key}`;
  await context.env.FILES.put(objectKey, data, {
    httpMetadata: { contentType: mime },
  });
  try {
    const database = context.get('database')();
    const insert = database.insert(files).values({
      id: key,
      objectKey,
      filename,
      mime,
      size: data.byteLength,
      kind,
      createdAt: Date.now(),
    });
    if (kind === 'proof') await insert;
    else
      await database.batch([
        insert,
        database
          .update(settings)
          .set({
            ...(kind === 'watermark'
              ? { watermarkFileId: key }
              : { signatureFileId: key }),
            updatedAt: Date.now(),
          })
          .where(eq(settings.id, 1)),
      ]);
  } catch (error) {
    await context.env.FILES.delete(objectKey);
    throw error;
  }
  return context.json({ id: key }, 201);
}

function imageMime(bytes: Uint8Array) {
  if (
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  throw new HTTPException(422, {
    message: 'Only valid PNG, JPEG and WebP images are accepted.',
  });
}

export const fileRoutes = new Hono<AppEnvironment>()
  .get('/', async (context) => {
    const query = z
      .object({
        before: z.coerce.number().int().min(0).optional(),
        beforeId: id.optional(),
      })
      .parse(context.req.query());
    const items = await context
      .get('database')()
      .select({
        id: files.id,
        filename: files.filename,
        kind: files.kind,
        size: files.size,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(
        query.before === undefined || query.beforeId === undefined
          ? undefined
          : or(
              lt(files.createdAt, query.before),
              and(
                eq(files.createdAt, query.before),
                lt(files.id, query.beforeId),
              ),
            ),
      )
      .orderBy(desc(files.createdAt), desc(files.id))
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
  .get('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const [item] = await context
      .get('database')()
      .select({ objectKey: files.objectKey, mime: files.mime })
      .from(files)
      .where(eq(files.id, key))
      .limit(1);
    if (item === undefined)
      throw new HTTPException(404, { message: 'File not found.' });
    const object = await context.env.FILES.get(item.objectKey);
    if (object === null)
      throw new HTTPException(404, { message: 'File not found in storage.' });
    return new Response(object.body, {
      headers: {
        'Content-Type': item.mime,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  })
  .post('/defaults/:kind', async (context) => {
    const kind = z
      .enum(['watermark', 'signature'])
      .parse(context.req.param('kind'));
    const bytes = Uint8Array.from(atob(defaultImages[kind]), (character) =>
      character.charCodeAt(0),
    );
    return storeImage(context, kind, `default-${kind}.png`, bytes.buffer);
  })
  .post('/:kind', async (context) => {
    const kind = z
      .enum(['proof', 'watermark', 'signature'])
      .parse(context.req.param('kind'));
    const filename = z
      .string()
      .trim()
      .min(1)
      .max(180)
      .parse(decodeURIComponent(context.req.header('X-File-Name') ?? 'image'));
    const data = await context.req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > 3_000_000)
      throw new HTTPException(422, {
        message: 'Choose an image between 1 byte and 3 MB.',
      });
    return storeImage(context, kind, filename, data);
  })
  .delete('/:id', async (context) => {
    const key = id.parse(context.req.param('id'));
    const database = context.get('database')();
    const [item] = await database
      .select({ objectKey: files.objectKey })
      .from(files)
      .where(eq(files.id, key))
      .limit(1);
    if (item === undefined)
      throw new HTTPException(404, { message: 'File not found.' });
    await context.env.FILES.delete(item.objectKey);
    await database.delete(files).where(eq(files.id, key));
    return context.json({ ok: true });
  });
