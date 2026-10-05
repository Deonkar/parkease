import { z } from 'zod';

/**
 * Two values, not the spec's three: "reported" is `is_reported`, and a third status would be a
 * second source for the same fact. Reporting never hides a review; only an admin removes one.
 */
export const REVIEW_MODERATION_STATUS_VALUES = ['visible', 'removed'] as const;

export const reviewModerationStatusSchema = z.enum(REVIEW_MODERATION_STATUS_VALUES);
export type ReviewModerationStatus = z.infer<typeof reviewModerationStatusSchema>;

export const ReviewModerationStatus = {
  VISIBLE: 'visible',
  REMOVED: 'removed',
} as const satisfies Record<string, ReviewModerationStatus>;

type _MissingFromObject = Exclude<
  ReviewModerationStatus,
  (typeof ReviewModerationStatus)[keyof typeof ReviewModerationStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
