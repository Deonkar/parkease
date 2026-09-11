import { z } from 'zod';

import { payoutStatusSchema } from '../enums/payout-status.js';
import { payoutIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

export const payoutSchema = z.object({
  id: payoutIdSchema,
  amountPaise: paiseSchema,
  status: payoutStatusSchema,
  initiatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  reference: z.string().nullable(),
});

export type Payout = z.infer<typeof payoutSchema>;
