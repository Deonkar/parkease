import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { createReview, fetchSpaceReviews, respondToReview } from '../reviews/api';

vi.mock('@/lib/secure-storage', () => ({
  secureStorage: { read: vi.fn(() => Promise.resolve(null)), write: vi.fn(), clear: vi.fn() },
}));

const mock = new MockAdapter(api);

const REVIEW = {
  id: '0192f1c0-0000-7000-8000-000000001000',
  bookingId: '0192f1c0-0000-7000-8000-0000000000b0',
  targetType: 'space',
  targetId: '0192f1b3-0000-7000-8000-000000000001',
  rating: 4,
  comment: 'Easy to find.',
  reviewerName: 'Ravi K.',
  createdAt: '2026-10-03T10:00:00.000Z',
  ownerResponse: null,
  ownerRespondedAt: null,
};

beforeEach(() => {
  mock.reset();
});
afterEach(() => vi.clearAllMocks());

describe('reviews api', () => {
  it('pages a space by the cursor it was given', async () => {
    mock
      .onGet('/driver/spaces/s1/reviews', { params: { cursor: 'c1' } })
      .reply(200, { data: [REVIEW], meta: { limit: 20, hasMore: false, nextCursor: null } });

    const page = await fetchSpaceReviews('s1', 'c1');
    expect(page.data[0]?.reviewerName).toBe('Ravi K.');
    expect(page.meta.nextCursor).toBeNull();
  });

  it('refuses a public review that carries the report flag', async () => {
    mock.onGet('/driver/spaces/s1/reviews').reply(200, {
      data: [{ ...REVIEW, isReported: true }],
      meta: { limit: 20, hasMore: false, nextCursor: null },
    });
    await expect(fetchSpaceReviews('s1', undefined)).rejects.toThrow();
  });

  it('sends the intent key the caller minted, not a fresh one', async () => {
    mock.onPost('/driver/reviews').reply(201, { data: { ...REVIEW, isReported: false } });

    await createReview(
      {
        bookingId: REVIEW.bookingId as never,
        targetType: 'space',
        targetId: REVIEW.targetId,
        rating: 4,
      },
      { idempotencyKey: 'intent-1' },
    );
    expect(mock.history['post'][0]?.headers?.['Idempotency-Key']).toBe('intent-1');
  });

  it('parses the review an owner response returns', async () => {
    mock.onPost('/owner/reviews/r1/respond').reply(200, {
      data: {
        ...REVIEW,
        isReported: false,
        ownerResponse: 'Thanks!',
        ownerRespondedAt: REVIEW.createdAt,
      },
    });
    const review = await respondToReview('r1', 'Thanks!', { idempotencyKey: 'k' });
    expect(review.ownerResponse).toBe('Thanks!');
  });
});
