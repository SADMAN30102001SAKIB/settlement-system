import { z } from 'zod';

export const newPassword = z
  .string()
  .min(15, 'Use at least 15 characters.')
  .max(128);
export const loginUsername = z.string().trim().min(1).max(100);

export const adminAccountSchema = z.object({
  username: z.string(),
  version: z.number().int(),
});
export const brandAccessSchema = z.object({
  username: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
});
export const brandSessionSchema = z.object({
  brand: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export const documentKind = z.enum(['settlements', 'advertising', 'receipts']);
export const portalListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      date: z.string(),
      period: z.string(),
    }),
  ),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
