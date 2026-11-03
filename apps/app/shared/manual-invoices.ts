import { z } from 'zod';
import { letterDocument, letterText } from './letter';
import {
  assertMoney,
  sumMoney,
  toPaisaPrecision,
} from '@settlement/domain/money';
export const manualFields = z
  .object({
    date: z.iso.date(),
    title: z.string().trim().min(1).max(100),
    recipient: z.string().trim().max(200),
    notes: z.string().trim().max(2000),
    stamp: z.enum(['Paid', 'Unpaid', 'Due']).nullable().default(null),
    kind: z.enum(['itemized', 'letter']).default('itemized'),
    body: letterDocument.nullable().default(null),
    lines: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(200),
            quantityMilli: z.number().int().min(1).max(1000000000),
            price: z.number().int().min(0).max(1000000000000),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (doc.kind === 'itemized') {
      if (!doc.lines.length)
        ctx.addIssue({
          code: 'custom',
          path: ['lines'],
          message: 'Add at least one item.',
        });
      if (doc.body !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['body'],
          message: 'Itemized invoices cannot contain a letter.',
        });
    } else {
      if (
        !doc.body ||
        !letterText(doc.body).trim() ||
        letterText(doc.body).length > 20000
      )
        ctx.addIssue({
          code: 'custom',
          path: ['body'],
          message: 'Enter a letter of up to 20,000 characters.',
        });
      if (doc.lines.length || doc.stamp !== null || doc.notes)
        ctx.addIssue({
          code: 'custom',
          message:
            'Letters cannot include invoice items, payment stamps or separate invoice notes.',
        });
    }
  });
export const companySchema = z.object({
  companyName: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
});
export const manualSchema = manualFields.safeExtend({
  id: z.string(),
  number: z.string(),
  revision: z.number().int(),
  total: z.number().int(),
  company: companySchema,
});
export const manualListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      date: z.string(),
      title: z.string(),
      recipient: z.string(),
      total: z.number().int(),
      revision: z.number().int(),
      kind: z.enum(['itemized', 'letter']).default('itemized'),
    }),
  ),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
export function lineTotal(line: { quantityMilli: number; price: number }) {
  return toPaisaPrecision(
    assertMoney(
      Number((BigInt(line.price) * BigInt(line.quantityMilli) + 500n) / 1000n),
    ),
  );
}
export function manualTotal(lines: { quantityMilli: number; price: number }[]) {
  return sumMoney(lines.map(lineTotal));
}
