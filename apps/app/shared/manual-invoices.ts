import { z } from 'zod';
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
      .min(1)
      .max(50),
  })
  .strict();
export const companySchema = z.object({
  companyName: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
});
export const manualSchema = manualFields.extend({
  id: z.string(),
  number: z.string(),
  revision: z.number().int(),
  total: z.number().int(),
  company: companySchema,
});
export const manualListSchema = z.object({
  items: z.array(
    manualSchema.pick({
      id: true,
      number: true,
      date: true,
      title: true,
      recipient: true,
      total: true,
      revision: true,
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
