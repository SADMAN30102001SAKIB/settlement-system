import { z } from 'zod';

export const checklistTask = z.enum(['ordersDone', 'adsDone']);
export const checklistState = z.object({
  ordersDone: z.boolean(),
  adsDone: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const checklistRow = checklistState.extend({
  id: z.string(),
  name: z.string(),
});
export const checklistPage = z.object({
  items: z.array(checklistRow),
  next: z.object({ after: z.string() }).nullable(),
});
