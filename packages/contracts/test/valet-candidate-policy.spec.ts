import { describe, expect, it, vi } from 'vitest';

import { PARTNER_RATING_FLOOR_BP } from '../src/money/index.js';
import { findWithRatingFloor, type RatingFloorFallback } from '../src/valet/index.js';

const candidate = (ratingAvgBp: number | null) => ({ ratingAvgBp });

describe('findWithRatingFloor', () => {
  it('runs one pass at the floor and stops when it finds anyone', async () => {
    const run = vi.fn(async () => [candidate(48_000)]);
    const onFallback = vi.fn();

    const result = await findWithRatingFloor(run, onFallback);

    expect(result).toEqual([candidate(48_000)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(PARTNER_RATING_FLOOR_BP);
    expect(onFallback).not.toHaveBeenCalled();
  });

  /**
   * The second pass is the whole point: a single query with an OR would accept
   * anyone silently, which is indistinguishable from having no floor at all.
   */
  it('falls back to an unfiltered pass when nobody clears the floor', async () => {
    const run = vi
      .fn<(min: number | null) => Promise<{ ratingAvgBp: number | null }[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(29_000), candidate(34_000)]);
    const onFallback = vi.fn();

    const result = await findWithRatingFloor(run, onFallback);

    expect(result).toHaveLength(2);
    expect(run).toHaveBeenNthCalledWith(1, PARTNER_RATING_FLOOR_BP);
    expect(run).toHaveBeenNthCalledWith(2, null);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('reports the lowest rating it had to settle for', async () => {
    const run = vi
      .fn<(min: number | null) => Promise<{ ratingAvgBp: number | null }[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(34_000), candidate(29_000), candidate(31_000)]);
    const onFallback = vi.fn<(info: RatingFloorFallback) => void>();

    await findWithRatingFloor(run, onFallback);

    expect(onFallback).toHaveBeenCalledWith({ fallbackCandidates: 3, lowestRatingBp: 29_000 });
  });

  /**
   * An unrated partner in the fallback set must not be read as a 0-star one.
   * `null` means unrated, and `Math.min` over a null would report 0 and make the
   * warning say supply is far worse than it is.
   */
  it('ignores unrated partners when computing the lowest rating', async () => {
    const run = vi
      .fn<(min: number | null) => Promise<{ ratingAvgBp: number | null }[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(null), candidate(33_000), candidate(null)]);
    const onFallback = vi.fn<(info: RatingFloorFallback) => void>();

    await findWithRatingFloor(run, onFallback);

    expect(onFallback).toHaveBeenCalledWith({ fallbackCandidates: 3, lowestRatingBp: 33_000 });
  });

  it('reports a null lowest rating when every fallback candidate is unrated', async () => {
    const run = vi
      .fn<(min: number | null) => Promise<{ ratingAvgBp: number | null }[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(null)]);
    const onFallback = vi.fn<(info: RatingFloorFallback) => void>();

    await findWithRatingFloor(run, onFallback);

    expect(onFallback).toHaveBeenCalledWith({ fallbackCandidates: 1, lowestRatingBp: null });
  });

  /** Nobody at all is not a floor problem, so it is not reported as one. */
  it('returns empty without warning when both passes find nothing', async () => {
    const run = vi.fn(async () => []);
    const onFallback = vi.fn();

    expect(await findWithRatingFloor(run, onFallback)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
