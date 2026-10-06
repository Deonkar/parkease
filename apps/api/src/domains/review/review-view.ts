import type { PublicReviewView, ReviewView } from '@parkease/contracts/driver';
import { bookingIdSchema, reviewIdSchema } from '@parkease/contracts/primitives';

import type { ReviewRow } from './review.service.js';

/**
 * "Ravi Kumar" → "Ravi K." A full name is not a stranger's business; a first name and an initial
 * is enough to make a review read as written by a person.
 */
export function reviewerDisplayName(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const [first, ...rest] = parts;
  if (first === undefined) return 'ParkEase user';
  const lastInitial = rest.at(-1)?.[0];
  return lastInitial === undefined ? first : `${first} ${lastInitial.toUpperCase()}.`;
}

/**
 * One review as every role reads it — driver, owner and the space detail. Here rather than in a
 * role folder because three role folders use it, and roles never import each other (ADR-016).
 */
export function toReviewView({ review, reviewerName }: ReviewRow): ReviewView {
  return {
    id: reviewIdSchema.parse(review.id),
    bookingId: bookingIdSchema.parse(review.bookingId),
    targetType: review.targetType as ReviewView['targetType'],
    targetId: review.targetId,
    rating: review.rating,
    comment: review.comment,
    reviewerName: reviewerDisplayName(reviewerName),
    createdAt: review.createdAt.toISOString(),
    ownerResponse: review.ownerResponse,
    ownerRespondedAt: review.ownerRespondedAt?.toISOString() ?? null,
    isReported: review.isReported,
  };
}

/** The same, minus the report flag, for reviews any driver can read on a space. */
export function toPublicReviewView(row: ReviewRow): PublicReviewView {
  const { isReported, ...visible } = toReviewView(row);
  void isReported; // dropped on purpose; the strict public schema refuses it if it ever leaks
  return visible;
}
