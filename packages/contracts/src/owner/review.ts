import { z } from 'zod';

import { reviewSummarySchema } from '../driver/review.js';
import { bookingIdSchema, spaceIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';

/** An owner reviews the driver on a completed booking at one of their spaces. */
export const ownerCreateReviewSchema = z.object({
  bookingId: bookingIdSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2_000).optional(),
});

export type OwnerCreateReview = z.infer<typeof ownerCreateReviewSchema>;

/** One public response per review. */
export const respondToReviewSchema = z.object({
  response: z.string().trim().min(1).max(500),
});

export type RespondToReview = z.infer<typeof respondToReviewSchema>;

export const ownerReviewsQuerySchema = paginationQuerySchema.extend({
  spaceId: spaceIdSchema.optional(),
});

export type OwnerReviewsQuery = z.infer<typeof ownerReviewsQuerySchema>;

export const ownerSpaceReviewSummarySchema = reviewSummarySchema.extend({
  spaceId: spaceIdSchema,
  spaceTitle: z.string(),
  /** Reported and not yet moderated. */
  reportedCount: z.number().int().nonnegative(),
});

export type OwnerSpaceReviewSummary = z.infer<typeof ownerSpaceReviewSummarySchema>;
