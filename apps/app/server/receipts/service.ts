import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { sumMoney } from '@settlement/domain/money';
import {
  categorySchema,
  receiptDataSchema,
  receiptSchema,
} from '../../shared/receipts';
import type { PaymentReceipt } from '../../shared/receipts';
import { date, id, money } from '../validation';
import { loadPaymentAccount } from './account';
import { stampStatusSchema } from '../../shared/invoice-status';

export const receiptInput = z
  .object({
    requestId: id,
    brandId: id,
    version: z.number().int().nonnegative(),
    date,
    method: z.enum(['Cash', 'Bank transfer', 'bKash', 'Nagad', 'Other']),
    reference: z.string().trim().max(100),
    note: z.string().trim().max(200),
    proofFileId: id.nullable().default(null),
    stampStatus: stampStatusSchema.optional(),
    allocations: z
      .array(
        z
          .object({
            kind: categorySchema,
            invoiceId: id,
            amount: money.refine((n) => n > 0 && n % 10 === 0, {
              message:
                'Payments must be positive with at most two decimal places.',
            }),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
type Input = z.infer<typeof receiptInput>;

export async function receiptById(
  db: D1Database,
  key: string,
): Promise<PaymentReceipt | null> {
  const row = await db
    .prepare(
      `SELECT id,number,brand_id AS brandId,date,total,proof_file_id AS proofFileId,
    created_at AS createdAt,reversed_at AS reversedAt,reversal_reason AS reversalReason,stamp_status AS stampStatus,data FROM payment_receipts WHERE id=?`,
    )
    .bind(key)
    .first();
  if (!row) return null;
  const data = z.string().parse(row['data']);
  const decoded: unknown = JSON.parse(data);
  const deleted = await db
    .prepare(
      `SELECT COALESCE(l.settlement_id,l.ad_invoice_id) AS id
    FROM receipt_lines l LEFT JOIN settlements s ON s.id=l.settlement_id
    LEFT JOIN ad_invoices a ON a.id=l.ad_invoice_id
    WHERE l.receipt_id=? AND s.id IS NULL AND a.id IS NULL`,
    )
    .bind(key)
    .all<{ id: string }>();
  return receiptSchema.parse({
    ...row,
    data: decoded,
    deletedInvoiceIds: deleted.results.map((line) => line.id),
  });
}
export async function requestHash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function existingReceipt(
  db: D1Database,
  key: string,
  hash: string,
) {
  const existing = await db
    .prepare(
      `SELECT request_hash AS hash,0 AS deleted FROM payment_receipts WHERE id=?
      UNION ALL SELECT NULL AS hash,1 AS deleted FROM deleted_receipt_requests WHERE id=?`,
    )
    .bind(key, key)
    .first<{ hash: string | null; deleted: number }>();
  if (!existing) return null;
  if (existing.deleted === 1)
    throw new HTTPException(409, {
      message:
        'This payment request belongs to a deleted receipt. Reload before recording a new payment.',
    });
  if (existing.hash !== hash)
    throw new HTTPException(409, {
      message:
        'This payment request was already used for different details. Reload before recording another payment.',
    });
  return receiptById(db, key);
}
export async function createReceipt(
  db: D1Database,
  input: Input,
  hash: string,
) {
  const existing = await existingReceipt(db, input.requestId, hash);
  if (existing) return existing;
  const account = await loadPaymentAccount(db, input.brandId);
  if (account.version !== input.version)
    throw new HTTPException(409, {
      message:
        'This account changed. Reload balances and review the payment before submitting again.',
    });
  const keys = input.allocations.map((line) => line.kind + line.invoiceId);
  if (new Set(keys).size !== keys.length)
    throw new HTTPException(422, { message: 'Select each invoice only once.' });
  const lines = input.allocations.map((line) => {
    const invoice = account.invoices.find(
      (item) => item.kind === line.kind && item.id === line.invoiceId,
    );
    if (!invoice)
      throw new HTTPException(422, {
        message: 'Every invoice must belong to the selected brand.',
      });
    if (line.amount > invoice.due)
      throw new HTTPException(422, {
        message: `Payment exceeds the remaining balance of ${invoice.invoiceNumber}.`,
      });
    return {
      invoiceId: invoice.id,
      kind: line.kind,
      invoiceNumber: invoice.invoiceNumber,
      period: invoice.period,
      date: invoice.date,
      total: invoice.total,
      paidBefore: invoice.paid,
      received: line.amount,
      balanceAfter: invoice.due - line.amount,
    };
  });
  if (input.proofFileId) {
    const proof = await db
      .prepare('SELECT kind FROM files WHERE id=?')
      .bind(input.proofFileId)
      .first<{ kind: string }>();
    if (proof?.kind !== 'proof')
      throw new HTTPException(422, {
        message: 'Select a valid uploaded payment proof.',
      });
  }
  const company = z
    .object({
      companyName: z.string(),
      address: z.string(),
      phone: z.string(),
      email: z.string(),
    })
    .parse(
      await db
        .prepare(
          'SELECT company_name AS companyName,address,phone,email FROM settings WHERE id=1',
        )
        .first(),
    );
  const commissionReceived = sumMoney(
    lines.filter((l) => l.kind === 'commission').map((l) => l.received),
  );
  const adsReceived = sumMoney(
    lines.filter((l) => l.kind === 'ads').map((l) => l.received),
  );
  const data = receiptDataSchema.parse({
    ...company,
    brandName: account.brandName,
    method: input.method,
    reference: input.reference,
    note: input.note,
    commissionBefore: account.commission.due,
    adsBefore: account.ads.due,
    commissionReceived,
    adsReceived,
    commissionAfter: account.commission.due - commissionReceived,
    adsAfter: account.ads.due - adsReceived,
    commissionCredit: account.commission.credit,
    adsCredit: account.ads.credit,
    lines,
  });
  const counter = await db
    .prepare(
      `INSERT INTO invoice_counters (kind,date,value) VALUES ('payment',?,1)
    ON CONFLICT(kind,date) DO UPDATE SET value=value+1 RETURNING value`,
    )
    .bind(input.date)
    .first<{ value: number }>();
  if (!counter) throw new Error('Missing payment receipt counter.');
  const number = `PAY-${input.date.replaceAll('-', '')}-${String(counter.value).padStart(4, '0')}`;
  const now = Date.now(),
    total = sumMoney([commissionReceived, adsReceived]);
  const statements = [
    db
      .prepare(
        `INSERT INTO payment_receipts
    (id,number,brand_id,date,request_hash,data,total,proof_file_id,created_at,stamp_status)
    VALUES (?,?,?,?,?,?,CASE WHEN (SELECT payment_version FROM brands WHERE id=?)=? THEN ? ELSE -1 END,?,?,?)`,
      )
      .bind(
        input.requestId,
        number,
        input.brandId,
        input.date,
        hash,
        JSON.stringify(data),
        input.brandId,
        input.version,
        total,
        input.proofFileId,
        now,
        input.stampStatus ??
          (data.commissionAfter + data.adsAfter > 0 ? 'Due' : 'Paid'),
      ),
  ];
  const entries = JSON.stringify(
    lines.map((line) => ({
      id: crypto.randomUUID(),
      paymentId: crypto.randomUUID(),
      settlementId: line.kind === 'commission' ? line.invoiceId : null,
      adInvoiceId: line.kind === 'ads' ? line.invoiceId : null,
      amount: line.received,
    })),
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO receipt_lines (id,receipt_id,settlement_id,ad_invoice_id,payment_id)
          SELECT json_extract(value,'$.id'),?,json_extract(value,'$.settlementId'),
          json_extract(value,'$.adInvoiceId'),json_extract(value,'$.paymentId') FROM json_each(?)`,
      )
      .bind(input.requestId, entries),
    db
      .prepare(
        `INSERT INTO payments (id,settlement_id,ad_invoice_id,amount,date,note,proof_file_id,created_at,receipt_id)
          SELECT json_extract(value,'$.paymentId'),json_extract(value,'$.settlementId'),
          json_extract(value,'$.adInvoiceId'),json_extract(value,'$.amount'),?,?,?,?,? FROM json_each(?)`,
      )
      .bind(
        input.date,
        input.note,
        input.proofFileId,
        now,
        input.requestId,
        entries,
      ),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const retry = await existingReceipt(db, input.requestId, hash);
    if (retry) return retry;
    if (
      error instanceof Error &&
      error.message.includes('receipts_total_positive')
    )
      throw new HTTPException(409, {
        message:
          'This account changed during payment. Reload balances and try again.',
      });
    throw error;
  }
  const result = await receiptById(db, input.requestId);
  if (!result) throw new Error('Missing saved receipt.');
  return result;
}
