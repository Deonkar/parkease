import { z } from 'zod';

import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseSchema } from '../primitives/paise.js';

export const earningsQuerySchema = paginationQuerySchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type EarningsQuery = z.infer<typeof earningsQuerySchema>;

export const earningEntrySchema = z.object({
  date: z.string(),
  bookingCount: z.number().int().nonnegative(),
  grossPaise: paiseSchema,
  commissionPaise: paiseSchema,
  netPaise: paiseSchema,
});

export type EarningEntry = z.infer<typeof earningEntrySchema>;
