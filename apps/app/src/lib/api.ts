import { z } from 'zod';

const integer = z.number().int();
export const brandSchema = z.object({
  id: z.string(),
  name: z.string(),
  makingCost: integer.nullable(),
});
export type Brand = z.infer<typeof brandSchema>;
export const settingsSchema = z.object({
  companyName: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  signatureLabel: z.string(),
  agencyBasisPoints: integer,
  watermarkFileId: z.string().nullable(),
  signatureFileId: z.string().nullable(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const reportSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  brandId: z.string(),
  brandName: z.string(),
  date: z.string(),
  period: z.string(),
  rule: z.enum(['legacy', 'v2', 'v3']),
  deliveredCodCharge: integer,
  partialCodCharge: integer,
  vatBasisPoints: integer,
  deliveredQty: integer,
  deliveredAmount: integer,
  cancelledQty: integer,
  cancelledAmount: integer,
  partialQty: integer,
  partialAmount: integer,
  pendingQty: integer,
  shipping: integer,
  codCharge: integer,
  ads: integer,
  productCost: integer,
  costPerPiece: integer.nullable(),
  agencyBasisPoints: integer,
  gross: integer,
  net: integer,
  commission: integer,
  revision: integer,
  paid: integer,
});
export type Report = z.infer<typeof reportSchema>;
const reportRowSchema = reportSchema
  .pick({
    id: true,
    invoiceNumber: true,
    brandId: true,
    brandName: true,
    date: true,
    period: true,
    gross: true,
    net: true,
    commission: true,
    revision: true,
  })
  .extend({ paid: integer });
export type ReportRow = z.infer<typeof reportRowSchema>;
export const paymentSchema = z.object({
  id: z.string(),
  amount: integer,
  date: z.string(),
  note: z.string(),
  proofFileId: z.string().nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;
const campaignSchema = z.object({ name: z.string(), amount: integer });
const adSummarySchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  date: z.string(),
  period: z.string(),
  total: integer,
  paid: integer,
  directPaid: integer,
  revision: integer,
  createdAt: integer,
});
const adInvoiceSchema = adSummarySchema.omit({ directPaid: true }).extend({
  brandId: z.string(),
  brandName: z.string(),
  campaigns: z.array(campaignSchema),
});
export type AdInvoice = z.infer<typeof adInvoiceSchema>;
export const adAccountSchema = z.object({
  invoices: z.array(adSummarySchema),
  total: integer,
  paid: integer,
  accountPaid: integer,
  advance: integer,
  payments: z.array(paymentSchema),
});
export const adDetailSchema = z.object({
  item: adInvoiceSchema,
  payments: z.array(paymentSchema),
});
export const noteSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  brandName: z.string(),
  period: z.string(),
  type: z.enum(['Ads Invoice ready', '15% calculated', 'Both done', 'Other']),
  content: z.string(),
  createdAt: integer,
});
export type Note = z.infer<typeof noteSchema>;

export const SESSION_EXPIRED_EVENT = 'settlement:session-expired';

export async function api<S extends z.ZodType>(
  path: string,
  schema: S,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<z.output<S>> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...(options?.method === undefined ? {} : { method: options.method }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/manage/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(
      error.success ? error.data.error : 'The request could not be completed.',
    );
  }
  return schema.parse(payload);
}

export const okSchema = z.object({ ok: z.boolean() });
export const reportListSchema = z.object({
  summary: z.object({
    count: integer,
    net: integer,
    commission: integer,
    paid: integer,
    deliveredQty: integer,
    deliveredAmount: integer,
    cancelledQty: integer,
    cancelledAmount: integer,
    partialQty: integer,
    partialAmount: integer,
    pendingQty: integer,
    shipping: integer,
    codCharge: integer,
    ads: integer,
    productCost: integer,
  }),
  items: z.array(reportRowSchema),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
export const reportDetailSchema = z.object({
  item: reportSchema,
  payments: z.array(paymentSchema),
});
