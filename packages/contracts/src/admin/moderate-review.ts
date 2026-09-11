import { z } from 'zod';

import { reviewIdSchema } from '../primitives/ids.js';

export const moderateReviewSchema = z.object({
  reviewId: reviewIdSchema,
  action: z.enum(['approve', 'reject', 'flag']),
  reason: z.string().max(500).optional(),
});

export type ModerateReview = z.infer<typeof moderateReviewSchema>;
