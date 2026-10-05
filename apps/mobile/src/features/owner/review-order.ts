interface Answerable {
  readonly ownerResponse: string | null;
  readonly isReported: boolean;
}

/**
 * A review the owner can still usefully answer: no response yet, and not sitting in the moderation
 * queue (answering spam an admin may remove tomorrow is wasted effort).
 */
export const needsReply = (review: Answerable): boolean =>
  review.ownerResponse === null && !review.isReported;

/**
 * "Needs a reply" first (direction C's idea, kept with "Five stars"), then the rest, each group in
 * the server's newest-first order. A stable partition, not a sort on dates the client re-reads.
 */
export function orderForOwner<T extends Answerable>(reviews: readonly T[]): T[] {
  return [...reviews.filter(needsReply), ...reviews.filter((r) => !needsReply(r))];
}
