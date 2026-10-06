import { z } from 'zod';

/** Who or what a review is about. `driver` is reviewed by owners; the rest by drivers. */
export const REVIEW_TARGET_TYPE_VALUES = ['space', 'driver', 'valet', 'washer'] as const;

export const reviewTargetTypeSchema = z.enum(REVIEW_TARGET_TYPE_VALUES);
export type ReviewTargetType = z.infer<typeof reviewTargetTypeSchema>;

export const ReviewTargetType = {
  SPACE: 'space',
  DRIVER: 'driver',
  VALET: 'valet',
  WASHER: 'washer',
} as const satisfies Record<string, ReviewTargetType>;

type _MissingFromObject = Exclude<
  ReviewTargetType,
  (typeof ReviewTargetType)[keyof typeof ReviewTargetType]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
