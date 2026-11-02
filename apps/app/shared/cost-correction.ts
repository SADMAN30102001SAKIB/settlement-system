import { z } from 'zod';

export const costCorrectionPreview = z.object({
  version: z.string(),
  count: z.number().int(),
  deliveredUnits: z.number().int(),
  before: z.number().int(),
  after: z.number().int(),
});
