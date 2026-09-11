import { z } from 'zod';

import { reviewIdSchema } from '../primitives/ids.js';

export const reviewResponseSchema = z.object({
  reviewId: reviewIdSchema,
  response: z.string().min(1).max(1000),
});

export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
