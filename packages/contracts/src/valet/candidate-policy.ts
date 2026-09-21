import { PARTNER_RATING_FLOOR_BP } from '../money/rates.js';

export interface RatedCandidate {
  readonly ratingAvgBp: number | null;
}

export interface RatingFloorFallback {
  readonly fallbackCandidates: number;
  readonly lowestRatingBp: number | null;
}

/**
 * Two passes over the candidate query, with the floor able to fail visibly.
 *
 * Not one query with an `OR`: a single query that silently accepted anyone when
 * the filtered set came back empty would be indistinguishable from having no
 * floor at all, which is how v1 shipped a rating rule that existed only in
 * prose. The `onFallback` callback is what makes the second pass observable —
 * a caller that ignores it has reintroduced exactly that bug.
 *
 * The cost is explicit: when the floored pass returns nothing this is
 * **O(2 x scan)**, and it pays that at the moment latency matters most, with a
 * driver already waiting. That is the accepted trade.
 *
 * This lives in contracts because *both* the API (round 0) and the worker
 * (every widened round) run it. It was briefly hand-written in both, which is a
 * textbook second use (R-ARCH-07) and the precise drift the candidate query's
 * own docstring warns about: a change to the fallback — an extra pass, a
 * different empty-check, different log fields — would silently apply to one
 * round and not the others, and nothing would fail.
 *
 * Pure and transport-free: the caller supplies how to run the query and how to
 * report the fallback, so neither Drizzle nor a logger reaches this package.
 */
export async function findWithRatingFloor<T extends RatedCandidate>(
  run: (minRatingBp: number | null) => Promise<T[]>,
  onFallback: (info: RatingFloorFallback) => void,
): Promise<T[]> {
  const aboveFloor = await run(PARTNER_RATING_FLOOR_BP);
  if (aboveFloor.length > 0) return aboveFloor;

  const anyRating = await run(null);
  if (anyRating.length === 0) return [];

  onFallback({
    fallbackCandidates: anyRating.length,
    lowestRatingBp: anyRating.reduce<number | null>(
      (lowest, c) =>
        c.ratingAvgBp === null ? lowest : Math.min(lowest ?? c.ratingAvgBp, c.ratingAvgBp),
      null,
    ),
  });

  return anyRating;
}
