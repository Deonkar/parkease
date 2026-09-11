import { z } from 'zod';

import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseSchema } from '../primitives/paise.js';

export const washerEarningsQuerySchema = paginationQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type WasherEarningsQuery = z.infer<typeof washerEarningsQuerySchema>;

export const washerEarningEntrySchema = z.object({
  date: z.string(),
  jobsCompleted: z.number().int().nonnegative(),
  grossPaise: paiseSchema,
  commissionPaise: paiseSchema,
  netPaise: paiseSchema,
});

export type WasherEarningEntry = z.infer<typeof washerEarningEntrySchema>;
