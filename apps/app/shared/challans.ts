import { z } from 'zod';
export const challanFields = z
  .object({
    date: z.iso.date(),
    quantityMilli: z.number().int().min(1).max(1000000000),
    unitCost: z.number().int().min(0).max(1000000000000),
  })
  .strict();
export const challanSchema = challanFields.extend({
  id: z.uuid(),
  brandId: z.uuid(),
  total: z.number().int(),
  revision: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const challanListSchema = z.object({
  items: z.array(challanSchema),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
