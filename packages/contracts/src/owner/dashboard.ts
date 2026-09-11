import { z } from 'zod';

import { paiseSchema } from '../primitives/paise.js';

export const ownerDashboardSchema = z.object({
  totalSpaces: z.number().int().nonnegative(),
  activeBookings: z.number().int().nonnegative(),
  todayEarningsPaise: paiseSchema,
  monthEarningsPaise: paiseSchema,
  averageRating: z.number().min(0).max(5).nullable(),
  pendingPayoutPaise: paiseSchema,
});

export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
