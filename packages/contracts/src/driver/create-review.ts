import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';

export const createReviewSchema = z.object({
  bookingId: bookingIdSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export type CreateReview = z.infer<typeof createReviewSchema>;
