import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { invoiceStatusSchema } from '../../shared/invoice-status';
import type { AppEnvironment } from '../environment';
import { id } from '../validation';

export const settlementStatus = sql<
  string | null
>`(SELECT status FROM invoice_statuses WHERE settlement_id = settlements.id)`;
export const advertisingStatus = sql<
  string | null
>`(SELECT status FROM invoice_statuses WHERE ad_invoice_id = ad_invoices.id)`;

export const invoiceStatusRoutes = new Hono<AppEnvironment>().put(
  '/:kind/:id',
  async (c) => {
    const kind = z.enum(['settlement', 'ads']).parse(c.req.param('kind'));
    const key = id.parse(c.req.param('id'));
    const input = z
      .object({ status: invoiceStatusSchema })
      .strict()
      .parse(await c.req.json<unknown>());
    const source = kind === 'settlement' ? 'settlements' : 'ad_invoices';
    const column = kind === 'settlement' ? 'settlement_id' : 'ad_invoice_id';
    const result = await c.env.DB.prepare(
      `INSERT INTO invoice_statuses (id,${column},status,updated_at)
    SELECT ?,id,?,? FROM ${source} WHERE id=?
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at RETURNING status`,
    )
      .bind(`${kind}:${key}`, input.status, Date.now(), key)
      .first<{ status: string }>();
    if (!result)
      throw new HTTPException(404, { message: 'Invoice not found.' });
    return c.json({ ok: true });
  },
);
