import { z } from 'zod';
import { stampStatusSchema } from './invoice-status';

const amount = z.number().int();
export const categorySchema = z.enum(['commission', 'ads']);
const accountInvoiceSchema = z.object({
  id: z.string(),
  kind: categorySchema,
  invoiceNumber: z.string(),
  date: z.string(),
  period: z.string(),
  total: amount,
  paid: amount,
  due: amount,
  credit: amount,
  revision: amount,
});
const totalsSchema = z.object({
  billed: amount,
  paid: amount,
  due: amount,
  credit: amount,
});
export const paymentAccountSchema = z.object({
  brandId: z.string(),
  brandName: z.string(),
  version: amount,
  invoices: z.array(accountInvoiceSchema),
  commission: totalsSchema,
  ads: totalsSchema,
});
export const receiptDataSchema = z.object({
  brandName: z.string(),
  companyName: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  method: z.string(),
  reference: z.string(),
  note: z.string(),
  commissionBefore: amount,
  adsBefore: amount,
  commissionReceived: amount,
  adsReceived: amount,
  commissionAfter: amount,
  adsAfter: amount,
  commissionCredit: amount,
  adsCredit: amount,
  lines: z.array(
    z.object({
      invoiceId: z.string(),
      kind: categorySchema,
      invoiceNumber: z.string(),
      period: z.string(),
      date: z.string(),
      total: amount,
      paidBefore: amount,
      received: amount,
      balanceAfter: amount,
    }),
  ),
});
export const receiptSchema = z.object({
  deletedInvoiceIds: z.array(z.string()).default([]),
  id: z.string(),
  number: z.string(),
  brandId: z.string(),
  date: z.string(),
  total: amount,
  createdAt: amount,
  reversedAt: amount.nullable(),
  reversalReason: z.string().nullable(),
  proofFileId: z.string().nullable(),
  stampStatus: stampStatusSchema.nullable(),
  data: receiptDataSchema,
});
export const receiptListSchema = z.object({
  items: z.array(receiptSchema),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
export type PaymentAccount = z.infer<typeof paymentAccountSchema>;
export type PaymentReceipt = z.infer<typeof receiptSchema>;

export function receiptStampStatus(item: PaymentReceipt) {
  return (
    item.stampStatus ??
    (item.data.commissionAfter + item.data.adsAfter > 0 ? 'Due' : 'Paid')
  );
}
