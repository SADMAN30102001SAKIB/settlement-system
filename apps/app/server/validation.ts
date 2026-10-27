import { z } from 'zod';

export const id = z.uuid();
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const rate = z.number().int().min(0).max(10_000);
export const name = z.string().trim().min(1).max(80);
export const date = z.iso.date();
export const revision = z.number().int().min(1);
const counts = z.number().int().min(0).max(1_000_000);

export const range = z
  .object({
    from: date.optional(),
    to: date.optional(),
    brandId: id.optional(),
  })
  .refine(
    (input) =>
      input.from === undefined ||
      input.to === undefined ||
      input.from <= input.to,
    { message: 'The end date cannot be before the start date.' },
  );

export const settlementFields = z
  .object({
    brandId: id,
    date,
    period: z.string().trim().min(1).max(120),
    rule: z.enum(['legacy', 'v2', 'v3']).default('v3'),
    deliveredCodCharge: money.default(0),
    partialCodCharge: money.default(0),
    vatBasisPoints: rate.default(1000),
    vatAddedToAgency: z.boolean().default(true),
    deliveredQty: counts,
    deliveredUnits: counts.nullable().default(null),
    deductShipping: z.boolean().default(true),
    deliveredAmount: money,
    cancelledQty: counts,
    cancelledAmount: money,
    partialQty: counts,
    partialAmount: money,
    pendingQty: counts,
    shipping: money,
    codCharge: money,
    ads: money,
    productCost: money,
    costPerPiece: money.nullable(),
    agencyBasisPoints: rate,
  })
  .strict();
