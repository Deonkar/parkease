import { describe, expect, it } from 'vitest';

import {
  divRoundHalfUp,
  formatStars,
  MAX_RATING_BP,
  MIN_RATING_BP,
  type RatingBp,
  RECENCY_WINDOW_MS,
  toDisplayBp,
  weightedAverageBp,
} from '../src/primitives/rating.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-05T00:00:00Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const review = (rating: number, ageDays: number) => ({ rating, createdAt: daysAgo(ageDays) });

/** Deterministic, so a failure reproduces. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('weightedAverageBp', () => {
  it('is null for no reviews, never 0', () => {
    expect(weightedAverageBp([], NOW)).toBeNull();
  });

  it('cannot move a unanimous set, old or new', () => {
    expect(
      weightedAverageBp(
        [1, 2, 3, 4, 5].map(() => review(5, 100)),
        NOW,
      ),
    ).toBe(50_000);
    expect(
      weightedAverageBp(
        [1, 2, 3, 4, 5].map(() => review(5, 3)),
        NOW,
      ),
    ).toBe(50_000);
  });

  it('counts a recent review twice', () => {
    // (2×50000 + 1×10000) / 3. Unweighted it would be 30000.
    expect(weightedAverageBp([review(5, 10), review(1, 100)], NOW)).toBe(36_667);
  });

  it('cuts both directions', () => {
    expect(weightedAverageBp([review(5, 31), review(1, 10)], NOW)).toBe(23_333);
  });

  it('counts a review at exactly now − 30 days as recent', () => {
    const atBoundary = { rating: 5, createdAt: new Date(NOW.getTime() - RECENCY_WINDOW_MS) };
    const justOlder = { rating: 5, createdAt: new Date(NOW.getTime() - RECENCY_WINDOW_MS - 1) };
    expect(weightedAverageBp([atBoundary, review(1, 100)], NOW)).toBe(36_667);
    expect(weightedAverageBp([justOlder, review(1, 100)], NOW)).toBe(30_000);
  });

  it('is always an integer in [10000, 50000]', () => {
    const rand = lcg(17);
    for (let i = 0; i < 100_000; i++) {
      const size = 1 + Math.floor(rand() * 20);
      const set = Array.from({ length: size }, () =>
        review(1 + Math.floor(rand() * 5), rand() * 120),
      );
      const bp = weightedAverageBp(set, NOW);
      expect(Number.isInteger(bp)).toBe(true);
      expect(bp).toBeGreaterThanOrEqual(MIN_RATING_BP);
      expect(bp).toBeLessThanOrEqual(MAX_RATING_BP);
    }
  });
});

describe('divRoundHalfUp', () => {
  it('agrees with Math.round(n / d) on non-negative integers', () => {
    const rand = lcg(42);
    for (let i = 0; i < 100_000; i++) {
      const n = Math.floor(rand() * 1_000_000_000);
      const d = 1 + Math.floor(rand() * 10_000);
      expect(divRoundHalfUp(n, d)).toBe(Math.round(n / d));
    }
  });

  it('rounds exactly .5 up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(7, 2)).toBe(4);
  });

  it('refuses a non-positive denominator', () => {
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError);
  });
});

describe('toDisplayBp / formatStars', () => {
  it('rounds to one decimal of a star, half up', () => {
    expect(toDisplayBp(43_500 as RatingBp)).toBe(44_000);
    expect(toDisplayBp(43_400 as RatingBp)).toBe(43_000);
    expect(toDisplayBp(43_499 as RatingBp)).toBe(43_000);
  });

  it('renders 29950 as "3.0" — the display value, which no gate reads', () => {
    expect(formatStars(29_950 as RatingBp)).toBe('3.0');
    expect(formatStars(36_667 as RatingBp)).toBe('3.7');
  });
});
