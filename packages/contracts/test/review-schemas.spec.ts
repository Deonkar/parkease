import { describe, expect, it } from 'vitest';

import { createReviewSchema, ratingBadgeSchema } from '../src/driver/index.js';
import { ownerCreateReviewSchema, respondToReviewSchema } from '../src/owner/index.js';

const valid = {
  bookingId: '0192f1c0-0000-7000-8000-000000000001',
  targetType: 'space',
  targetId: '0192f1b3-0000-7000-8000-000000000002',
  rating: 4,
};

describe('createReviewSchema', () => {
  it('accepts a whole-star review of a space, valet or washer', () => {
    for (const targetType of ['space', 'valet', 'washer']) {
      expect(createReviewSchema.safeParse({ ...valid, targetType }).success).toBe(true);
    }
  });

  it.each([0, 6, 4.5, -1, Number.NaN, '5'])('rejects rating %s', (rating) => {
    expect(createReviewSchema.safeParse({ ...valid, rating }).success).toBe(false);
  });

  it('does not let a driver review a driver', () => {
    expect(createReviewSchema.safeParse({ ...valid, targetType: 'driver' }).success).toBe(false);
  });

  it('applies the same star rule to owners', () => {
    expect(
      ownerCreateReviewSchema.safeParse({ bookingId: valid.bookingId, rating: 4.5 }).success,
    ).toBe(false);
  });
});

describe('respondToReviewSchema', () => {
  it('rejects a whitespace-only response', () => {
    expect(respondToReviewSchema.safeParse({ response: '   ' }).success).toBe(false);
  });
});

describe('ratingBadgeSchema', () => {
  it('parses each kind', () => {
    expect(ratingBadgeSchema.parse({ kind: 'new', label: 'New' }).kind).toBe('new');
    expect(
      ratingBadgeSchema.parse({
        kind: 'low_rated',
        label: 'Mixed reviews',
        stars: '2.0',
        reviewCount: 3,
      }).kind,
    ).toBe('low_rated');
    expect(ratingBadgeSchema.parse({ kind: 'rated', stars: '4.0', reviewCount: 1 }).kind).toBe(
      'rated',
    );
  });

  it('never carries stars on "New" — the zero-star bug, refused by the contract', () => {
    expect(ratingBadgeSchema.safeParse({ kind: 'new', label: 'New', stars: '0.0' }).success).toBe(
      false,
    );
  });
});
