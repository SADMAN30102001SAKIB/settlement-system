import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Content } from '@google/genai';
import type { AppEnvironment } from '../environment';
import { runChat, providerError } from './engine';

const uuid = z.uuid();
const secret = z.string().trim().min(10).max(4096).regex(/^\S+$/);
const publicConversation = 'id,title,created_at AS createdAt,revision';

export const aiRoutes = new Hono<AppEnvironment>()
  .get('/credentials', async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT revision FROM ai_credentials WHERE id=1',
    ).first<{ revision: number }>();
    return c.json({ configured: !!row, revision: row?.revision ?? 0 });
  })
  .put('/credentials', async (c) => {
    const input = z
      .object({
        geminiKey: secret.optional(),
        metaToken: secret.optional(),
        revision: z.number().int().min(0),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    if (!input.geminiKey && !input.metaToken)
      throw new HTTPException(422, {
        message: 'Enter at least one credential to update.',
      });
    if (!input.revision && (!input.geminiKey || !input.metaToken))
      throw new HTTPException(422, {
        message: 'Enter both credentials for the initial connection.',
      });
    const updated = input.revision
      ? await c.env.DB.prepare(
          'UPDATE ai_credentials SET gemini_key=COALESCE(?,gemini_key),meta_token=COALESCE(?,meta_token),revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING revision',
        )
          .bind(
            input.geminiKey ?? null,
            input.metaToken ?? null,
            Date.now(),
            input.revision,
          )
          .first<{ revision: number }>()
      : await c.env.DB.prepare(
          'INSERT INTO ai_credentials (id,gemini_key,meta_token,revision,updated_at) VALUES (1,?,?,1,?) ON CONFLICT(id) DO NOTHING RETURNING revision',
        )
          .bind(input.geminiKey ?? '', input.metaToken ?? '', Date.now())
          .first<{ revision: number }>();
    if (!updated)
      throw new HTTPException(409, {
        message: 'AI settings changed in another tab. Reload before saving.',
      });
    return c.json({ configured: true, revision: updated.revision });
  })
  .delete('/credentials', async (c) => {
    const input = z
      .object({
        revision: z.number().int(),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const row = await c.env.DB.prepare(
      'DELETE FROM ai_credentials WHERE id=1 AND revision=? RETURNING id',
    )
      .bind(input.revision)
      .first();
    if (!row)
      throw new HTTPException(409, {
        message: 'AI settings changed. Reload before disconnecting.',
      });
    return c.json({ configured: false, revision: 0 });
  })
  .get('/conversations', async (c) => {
    const q = z
      .object({
        before: z.coerce.number().int().optional(),
        beforeId: uuid.optional(),
      })
      .strict()
      .refine((v) => !!v.before === !!v.beforeId)
      .parse(c.req.query());
    const rows = await c.env.DB.prepare(
      `SELECT ${publicConversation} FROM ai_conversations ${q.before ? 'WHERE (created_at,id)<(?,?)' : ''} ORDER BY created_at DESC,id DESC LIMIT 21`,
    )
      .bind(...(q.before ? [q.before, q.beforeId ?? ''] : []))
      .all<{
        id: string;
        title: string;
        createdAt: number;
        revision: number;
      }>();
    const last = rows.results[19];
    return c.json({
      items: rows.results.slice(0, 20),
      next:
        rows.results.length > 20 && last
          ? { before: last.createdAt, beforeId: last.id }
          : null,
    });
  })
  .post('/conversations', async (c) => {
    const input = z
      .object({ id: uuid })
      .strict()
      .parse(await c.req.json<unknown>());
    await c.env.DB.prepare(
      "INSERT INTO ai_conversations (id,title,created_at,updated_at) VALUES (?,'New chat',?,?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(input.id, Date.now(), Date.now())
      .run();
    return c.json({ ok: true });
  })
  .get('/conversations/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const q = z
      .object({ before: z.coerce.number().int().min(1).optional() })
      .strict()
      .parse(c.req.query());
    const item = await c.env.DB.prepare(
      `SELECT ${publicConversation} FROM ai_conversations WHERE id=?`,
    )
      .bind(id)
      .first();
    if (!item) throw new HTTPException(404, { message: 'Chat not found.' });
    await c.env.DB.prepare(
      `UPDATE ai_turns SET status='cancelled',answer='This response was interrupted. Send the question again.' WHERE conversation_id=? AND status='running' AND NOT EXISTS (SELECT 1 FROM ai_conversations WHERE id=? AND lease_until>?)`,
    )
      .bind(id, id, Date.now())
      .run();
    const rows = await c.env.DB.prepare(
      `SELECT id,question,answer,status,created_at AS createdAt,sequence FROM ai_turns WHERE conversation_id=? ${q.before ? 'AND sequence<?' : ''} ORDER BY sequence DESC LIMIT 21`,
    )
      .bind(id, ...(q.before ? [q.before] : []))
      .all<{
        id: string;
        question: string;
        answer: string;
        status: string;
        createdAt: number;
        sequence: number;
      }>();
    const last = rows.results[19];
    return c.json({
      item,
      items: rows.results.slice(0, 20).reverse(),
      next: rows.results.length > 20 && last ? { before: last.sequence } : null,
    });
  })
  .delete('/conversations/:id', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const row = await c.env.DB.prepare(
      'DELETE FROM ai_conversations WHERE id=? AND lease_until<=? RETURNING id',
    )
      .bind(id, Date.now())
      .first();
    if (!row)
      throw new HTTPException(409, {
        message: 'Stop the active response before deleting this chat.',
      });
    return c.json({ ok: true });
  })
  .post('/conversations/:id/cancel', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE ai_turns SET status='cancelled',answer='Response stopped.' WHERE conversation_id=? AND status='running'`,
      ).bind(id),
      c.env.DB.prepare(
        'UPDATE ai_conversations SET active_run=NULL,lease_until=0 WHERE id=?',
      ).bind(id),
    ]);
    return c.json({ ok: true });
  })
  .post('/conversations/:id/messages', async (c) => {
    const id = uuid.parse(c.req.param('id'));
    const input = z
      .object({
        id: uuid,
        question: z.string().trim().min(1).max(8000),
        revision: z.number().int().min(0),
      })
      .strict()
      .parse(await c.req.json<unknown>());
    const credentials = await c.env.DB.prepare(
      'SELECT gemini_key AS geminiKey,meta_token AS metaToken,revision,updated_at AS updatedAt FROM ai_credentials WHERE id=1',
    ).first<{
      geminiKey: string;
      metaToken: string;
      revision: number;
      updatedAt: number;
    }>();
    if (!credentials)
      throw new HTTPException(409, {
        message: 'Connect Gemini and Meta in Invoice settings first.',
      });
    const existing = await c.env.DB.prepare(
      'SELECT id FROM ai_turns WHERE id=?',
    )
      .bind(input.id)
      .first();
    if (existing)
      throw new HTTPException(409, {
        message:
          'This message was already submitted. Reload the conversation to see its result.',
      });
    const now = Date.now();
    const claim = await c.env.DB.prepare(
      'UPDATE ai_conversations SET active_run=?,lease_until=?,revision=revision+1,updated_at=?,title=CASE WHEN revision=0 THEN ? ELSE title END WHERE id=? AND revision=? AND lease_until<=? RETURNING revision',
    )
      .bind(
        input.id,
        now + 180000,
        now,
        input.question.slice(0, 80),
        id,
        input.revision,
        now,
      )
      .first<{ revision: number }>();
    if (!claim)
      throw new HTTPException(409, {
        message:
          'This chat changed or has a response running. Reload it before sending.',
      });
    try {
      await c.env.DB.prepare(
        `INSERT INTO ai_turns (id,conversation_id,sequence,question,status,created_at) VALUES (?,?,?,?,'running',?)`,
      )
        .bind(input.id, id, claim.revision, input.question, now)
        .run();
    } catch (error) {
      await c.env.DB.prepare(
        'UPDATE ai_conversations SET active_run=NULL,lease_until=0 WHERE id=? AND active_run=?',
      )
        .bind(id, input.id)
        .run();
      throw error;
    }
    const prior = await c.env.DB.prepare(
      `SELECT history FROM ai_turns WHERE conversation_id=? AND sequence<? AND status='complete' ORDER BY sequence DESC LIMIT 12`,
    )
      .bind(id, claim.revision)
      .all<{ history: string }>();
    const history: Content[] = [];
    let bytes = 0;
    for (const turn of prior.results) {
      bytes += turn.history.length;
      if (bytes > 180000) break;
      // Only backend-generated SDK content is stored here; clients cannot supply history.
      history.unshift(...(JSON.parse(turn.history) as Content[]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 175000);
    return streamSSE(c, async (stream) => {
      let lastCheck = 0;
      stream.onAbort(() => {
        controller.abort();
      });
      const emit = async (
        event: Parameters<Parameters<typeof runChat>[0]['emit']>[0],
      ) => {
        if (!stream.aborted)
          await stream.writeSSE({ data: JSON.stringify(event) });
      };
      try {
        const result = await runChat({
          ...credentials,
          history,
          question: input.question,
          signal: controller.signal,
          emit,
          check: async () => {
            controller.signal.throwIfAborted();
            if (Date.now() - lastCheck < 30000) return;
            lastCheck = Date.now();
            const active = await c.env.DB.prepare(
              'SELECT id FROM ai_conversations WHERE id=? AND active_run=? AND lease_until>? AND EXISTS (SELECT 1 FROM ai_credentials WHERE id=1 AND revision=? AND updated_at=?)',
            )
              .bind(
                id,
                input.id,
                Date.now(),
                credentials.revision,
                credentials.updatedAt,
              )
              .first();
            if (!active) {
              controller.abort();
              controller.signal.throwIfAborted();
            }
          },
        });
        controller.signal.throwIfAborted();
        const saved = await c.env.DB.prepare(
          `UPDATE ai_turns SET answer=?,history=?,status='complete' WHERE id=? AND status='running' AND EXISTS (SELECT 1 FROM ai_conversations WHERE id=? AND active_run=? AND lease_until>?) AND EXISTS (SELECT 1 FROM ai_credentials WHERE id=1 AND revision=? AND updated_at=?) RETURNING id`,
        )
          .bind(
            result.answer,
            JSON.stringify(result.history),
            input.id,
            id,
            input.id,
            Date.now(),
            credentials.revision,
            credentials.updatedAt,
          )
          .first();
        if (saved) await emit({ type: 'done' });
        else
          await emit({
            type: 'error',
            text: 'Response stopped. Reload to see the latest conversation.',
          });
      } catch (error) {
        const text = providerError(error);
        await c.env.DB.prepare(
          `UPDATE ai_turns SET answer=?,status=? WHERE id=? AND status='running'`,
        )
          .bind(
            text,
            controller.signal.aborted ? 'cancelled' : 'error',
            input.id,
          )
          .run();
        await emit({ type: 'error', text });
      } finally {
        clearTimeout(timer);
        await c.env.DB.prepare(
          'UPDATE ai_conversations SET active_run=NULL,lease_until=0 WHERE id=? AND active_run=?',
        )
          .bind(id, input.id)
          .run();
      }
    });
  });
