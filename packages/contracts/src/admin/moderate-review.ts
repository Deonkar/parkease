import { z } from 'zod';

import { reviewReportReasonSchema } from '../enums/review-report-reason.js';
import { reviewTargetTypeSchema } from '../enums/review-target-type.js';
import { reviewIdSchema } from '../primitives/ids.js';

/** Removal is audited with this reason; dismissal takes no body. */
export const removeReviewSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type RemoveReview = z.infer<typeof removeReviewSchema>;

export const moderationQueueItemSchema = z.object({
  id: reviewIdSchema,
  targetType: reviewTargetTypeSchema,
  targetId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string().datetime(),
  reports: z.array(
    z.object({
      reason: reviewReportReasonSchema,
      detail: z.string().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  /**
   * What removing this review does to the target's rating, so the moderator sees the cost of
   * the decision before making it. Null averages mean no rating would remain (or none exists).
   */
  impact: z.object({
    currentAvgBp: z.number().int().nullable(),
    avgBpIfRemoved: z.number().int().nullable(),
    countIfRemoved: z.number().int().nonnegative(),
  }),
});

export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;
