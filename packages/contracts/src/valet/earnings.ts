import { z } from 'zod';

import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseSchema } from '../primitives/paise.js';

export const valetEarningsQuerySchema = paginationQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type ValetEarningsQuery = z.infer<typeof valetEarningsQuerySchema>;

export const valetEarningEntrySchema = z.object({
  date: z.string(),
  jobsCompleted: z.number().int().nonnegative(),
  grossPaise: paiseSchema,
  commissionPaise: paiseSchema,
  netPaise: paiseSchema,
});

export type ValetEarningEntry = z.infer<typeof valetEarningEntrySchema>;
