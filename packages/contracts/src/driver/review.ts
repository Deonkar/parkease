import { z } from 'zod';

import { reviewReportReasonSchema } from '../enums/review-report-reason.js';
import { reviewTargetTypeSchema } from '../enums/review-target-type.js';
import { bookingIdSchema, reviewIdSchema } from '../primitives/ids.js';

/**
 * The raw comment bound. The real limit is 500 code points AFTER sanitisation (task 17 §17.5),
 * checked in `domains/review`: 500 visible characters padded with zero-width joiners is a
 * 500-character comment, not a rejected one. This only stops an unbounded payload.
 */
const MAX_RAW_COMMENT = 2_000;

const starsSchema = z.number().int().min(1).max(5);

/** A driver reviews the space, the valet, or a washer on a completed booking. */
export const createReviewSchema = z.object({
  bookingId: bookingIdSchema,
  targetType: reviewTargetTypeSchema.exclude(['driver']),
  targetId: z.string().uuid(),
  rating: starsSchema,
  comment: z.string().max(MAX_RAW_COMMENT).optional(),
});

export type CreateReview = z.infer<typeof createReviewSchema>;

export const reportReviewSchema = z.object({
  reason: reviewReportReasonSchema,
  detail: z.string().max(500).optional(),
});

export type ReportReview = z.infer<typeof reportReviewSchema>;

/**
 * What a space's rating shows. Never `★ 0.0 (0)`: no reviews is "New". `stars` is the display
 * string; the warning is decided on the stored basis points, so 29950 bp shows "3.0" and is
 * still `low_rated`.
 */
export const ratingBadgeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new'), label: z.literal('New') }).strict(),
  z
    .object({
      kind: z.literal('low_rated'),
      label: z.literal('Mixed reviews'),
      stars: z.string(),
      reviewCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rated'),
      stars: z.string(),
      reviewCount: z.number().int().positive(),
    })
    .strict(),
]);

export type RatingBadge = z.infer<typeof ratingBadgeSchema>;

export const reviewViewSchema = z.object({
  id: reviewIdSchema,
  bookingId: bookingIdSchema,
  targetType: reviewTargetTypeSchema,
  targetId: z.string().uuid(),
  rating: starsSchema,
  comment: z.string().nullable(),
  /** First name and last initial — "Ravi K." */
  reviewerName: z.string(),
  createdAt: z.string().datetime(),
  ownerResponse: z.string().nullable(),
  ownerRespondedAt: z.string().datetime().nullable(),
  isReported: z.boolean(),
});

export type ReviewView = z.infer<typeof reviewViewSchema>;

const countSchema = z.number().int().nonnegative();

/**
 * The average is recency-weighted (from the read model); the distribution is a plain count of
 * opinions, so the bars sum to `ratingCount`. The two can look inconsistent, by design.
 */
export const reviewSummarySchema = z.object({
  ratingAvgBp: z.number().int().min(10_000).max(50_000).nullable(),
  ratingCount: countSchema,
  distribution: z.object({
    1: countSchema,
    2: countSchema,
    3: countSchema,
    4: countSchema,
    5: countSchema,
  }),
});

export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/** A completed booking still inside its seven-day review window. Drives the in-app prompt. */
export const pendingReviewSchema = z.object({
  bookingId: bookingIdSchema,
  spaceTitle: z.string(),
  completedAt: z.string().datetime(),
  reviewableUntil: z.string().datetime(),
  targets: z.array(
    z.object({
      targetType: reviewTargetTypeSchema.exclude(['driver']),
      targetId: z.string().uuid(),
      name: z.string(),
      reviewed: z.boolean(),
    }),
  ),
});

export type PendingReview = z.infer<typeof pendingReviewSchema>;
