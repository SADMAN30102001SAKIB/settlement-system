import { z } from 'zod';
export const advanceSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number().int(),
  method: z.string(),
  reference: z.string(),
  note: z.string(),
  reversedAt: z.number().nullable(),
  reversalReason: z.string().nullable(),
});
export const advanceListSchema = z.object({
  items: z.array(advanceSchema),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
