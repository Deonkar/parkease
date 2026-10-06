import { describe, expect, it } from 'vitest';

import { needsReply, orderForOwner } from '../review-order';

const review = (
  id: string,
  over: { ownerResponse?: string | null; isReported?: boolean } = {},
) => ({
  id,
  ownerResponse: over.ownerResponse ?? null,
  isReported: over.isReported ?? false,
});

describe('needsReply', () => {
  it('is an unanswered review that is not under report', () => {
    expect(needsReply(review('a'))).toBe(true);
    expect(needsReply(review('b', { ownerResponse: 'Thanks' }))).toBe(false);
    expect(needsReply(review('c', { isReported: true }))).toBe(false);
  });
});

describe('orderForOwner', () => {
  it('puts what needs a reply first and otherwise keeps the server order (newest first)', () => {
    const list = [
      review('answered-new', { ownerResponse: 'ok' }),
      review('open-1'),
      review('reported', { isReported: true }),
      review('open-2'),
    ];
    expect(orderForOwner(list).map((r) => r.id)).toEqual([
      'open-1',
      'open-2',
      'answered-new',
      'reported',
    ]);
  });
});
