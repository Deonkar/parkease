/**
 * Ratings as integers (task 17 §17.3). A review is integer stars 1..5; an aggregate is basis
 * points, `4.35★ = 43500`. No float is stored, compared or averaged — the same treatment money
 * gets (ADR-008), because the aggregate drives the partner assignment floor and the warning badge.
 *
 * Shared by the API (recompute on every review write) and the worker (the nightly recompute of
 * reviews ageing out of the recency window), so the two cannot disagree on the arithmetic.
 */
export type RatingBp = number & { readonly __brand: 'RatingBp' };

export const BP_PER_STAR = 10_000;
export const MIN_RATING_BP = 1 * BP_PER_STAR;
export const MAX_RATING_BP = 5 * BP_PER_STAR;
/** One decimal place of a star. */
export const DISPLAY_STEP_BP = 1_000;

/** Reviews newer than this count twice. */
export const RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const RECENT_WEIGHT = 2;
export const OLDER_WEIGHT = 1;

/**
 * A space below 3.0★ with at least three reviews shows "Mixed reviews". Three, because one
 * one-star review from a driver who could not find the gate should not brand a space.
 * Compared against the stored average, never the display value.
 */
export const SPACE_WARNING_BELOW_BP = 30_000;
export const SPACE_WARNING_MIN_REVIEWS = 3;

/** Half-up division on non-negative integers. No floats, no Number.EPSILON games. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export type WeightedInput = { readonly rating: number; readonly createdAt: Date };

/**
 * Recency-weighted average in basis points.
 *
 * A review inside the 30-day window counts twice, so a space that got better recovers within a
 * month and a space that got worse is flagged within a month. A step, not a decay curve: a step
 * is explainable to an owner who asks why their number moved.
 */
export function weightedAverageBp(reviews: readonly WeightedInput[], now: Date): RatingBp | null {
  if (reviews.length === 0) return null;

  const cutoff = now.getTime() - RECENCY_WINDOW_MS;

  let weightedSumBp = 0;
  let weightTotal = 0;

  for (const review of reviews) {
    const weight = review.createdAt.getTime() >= cutoff ? RECENT_WEIGHT : OLDER_WEIGHT;
    weightedSumBp += weight * review.rating * BP_PER_STAR;
    weightTotal += weight;
  }

  return divRoundHalfUp(weightedSumBp, weightTotal) as RatingBp;
}

/** The integer equivalent of `Math.round(stars * 10) / 10`: 43500 → 44000, 43400 → 43000. */
export function toDisplayBp(bp: RatingBp): RatingBp {
  return (divRoundHalfUp(bp, DISPLAY_STEP_BP) * DISPLAY_STEP_BP) as RatingBp;
}

/** Presentation only. Never used to compare, sort, or gate. */
export const formatStars = (bp: RatingBp): string => (toDisplayBp(bp) / BP_PER_STAR).toFixed(1);
