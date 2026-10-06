import type { RatingBadge } from '@parkease/contracts/driver';
import {
  formatStars,
  type RatingBp,
  SPACE_WARNING_BELOW_BP,
  SPACE_WARNING_MIN_REVIEWS,
} from '@parkease/contracts/primitives';

/**
 * Task 17 §17.7. No reviews is "New", never zero stars. The warning reads the STORED average, so
 * 29950 bp shows "3.0" and still warns: a rounding artefact must not clear a trust check. The
 * label is factual — "Mixed reviews", not "Poorly rated" — about someone's property.
 *
 * Shared by the search card and the detail header, so the two cannot disagree.
 */
export function toRatingBadge(space: {
  readonly ratingAvgBp: number | null;
  readonly ratingCount: number;
}): RatingBadge {
  if (space.ratingCount === 0 || space.ratingAvgBp === null) {
    return { kind: 'new', label: 'New' };
  }

  // A read-model column, kept in 10000..50000 by spaces_rating_read_model_check.
  const bp = space.ratingAvgBp as RatingBp;

  if (bp < SPACE_WARNING_BELOW_BP && space.ratingCount >= SPACE_WARNING_MIN_REVIEWS) {
    return {
      kind: 'low_rated',
      label: 'Mixed reviews',
      stars: formatStars(bp),
      reviewCount: space.ratingCount,
    };
  }

  return { kind: 'rated', stars: formatStars(bp), reviewCount: space.ratingCount };
}
