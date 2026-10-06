import { ratingBadgeSchema } from '@parkease/contracts/driver';
import { describe, expect, it } from 'vitest';

import { toRatingBadge } from '../src/roles/driver/views/rating-badge.view.js';

describe('toRatingBadge', () => {
  it('shows "New" for a space nobody has reviewed — no stars at all, never 0.0', () => {
    const badge = toRatingBadge({ ratingAvgBp: null, ratingCount: 0 });
    expect(badge).toEqual({ kind: 'new', label: 'New' });
    expect(badge).not.toHaveProperty('stars');
  });

  it('warns below 3.0 stars once there are three reviews', () => {
    expect(toRatingBadge({ ratingAvgBp: 29_000, ratingCount: 3 })).toEqual({
      kind: 'low_rated',
      label: 'Mixed reviews',
      stars: '2.9',
      reviewCount: 3,
    });
  });

  it('does not brand a space on two reviews', () => {
    expect(toRatingBadge({ ratingAvgBp: 29_000, ratingCount: 2 })).toEqual({
      kind: 'rated',
      stars: '2.9',
      reviewCount: 2,
    });
  });

  it('gates on the stored value: 29950 displays as 3.0 and still warns', () => {
    expect(toRatingBadge({ ratingAvgBp: 29_950, ratingCount: 5 })).toMatchObject({
      kind: 'low_rated',
      stars: '3.0',
    });
  });

  it('does not warn at exactly 3.0', () => {
    expect(toRatingBadge({ ratingAvgBp: 30_000, ratingCount: 5 }).kind).toBe('rated');
  });

  it('always satisfies the contract', () => {
    for (const [avg, n] of [
      [null, 0],
      [10_000, 3],
      [50_000, 1],
      [29_999, 3],
    ] as const) {
      expect(
        ratingBadgeSchema.safeParse(toRatingBadge({ ratingAvgBp: avg, ratingCount: n })).success,
      ).toBe(true);
    }
  });
});
