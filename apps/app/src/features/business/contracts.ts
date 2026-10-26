import { z } from 'zod';
const integer = z.number().int();
const orderSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  orderDate: z.string(),
  deliveryDate: z.string().nullable(),
  status: z.enum(['Delivered', 'Cancelled', 'Partial Delivered', 'Pending']),
  quantity: integer,
  partialQuantity: integer.nullable(),
  salesOverride: integer.nullable(),
  costPerPiece: integer.nullable(),
  codAmount: integer,
  shipping: integer,
  codCharge: integer,
  ads: integer,
  revision: integer,
});
export type Order = z.infer<typeof orderSchema>;
export const orderListSchema = z.object({
  items: z.array(orderSchema),
  next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
});
const figures = z.object({
  count: integer,
  delivered: integer,
  cancelled: integer,
  partial: integer,
  pending: integer,
  revenue: integer,
  ads: integer,
  productCost: integer,
  shipping: integer,
  codCharge: integer,
  missingCosts: integer,
});
export const businessReportSchema = z.object({
  advertising: z.array(
    z.object({ date: z.string(), brandId: z.string(), amount: integer }),
  ),
  totals: figures.extend({
    otherExpenses: integer,
    net: integer,
    commission: integer,
  }),
  days: z.array(figures.extend({ date: z.string(), codAmount: integer })),
  expenses: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      description: z.string(),
      amount: integer,
    }),
  ),
});
