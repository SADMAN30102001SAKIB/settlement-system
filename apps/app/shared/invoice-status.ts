import { z } from 'zod';

export const invoiceStatusSchema = z.enum([
  'Unpaid',
  'Paid',
  'Due',
  'Advance',
  'N/A',
]);
export const stampStatusSchema = z.enum(['Paid', 'Unpaid', 'Due']);
export const stampKinds = ['stamp-paid', 'stamp-unpaid', 'stamp-due'] as const;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
