import type { PendingReview } from '@parkease/contracts/driver';
import { bookingIdSchema } from '@parkease/contracts/primitives';

import { REVIEW_WINDOW_MS } from '../../../domains/review/eligibility.js';
import { reviewerDisplayName } from '../../../domains/review/review-view.js';
import type { PendingBooking } from '../../../domains/review/review.service.js';

/** One booking the driver can still review, and which of its counterparties they already have. */
export function toPendingReviewView({ participants, reviewed }: PendingBooking): PendingReview {
  const { booking, valets, washers } = participants;
  // pendingFor selects on completed_at, so a null here is a broken query, not a state to render.
  const { completedAt } = booking;
  if (completedAt === null) throw new Error(`pending booking ${booking.id} has no completed_at`);
  const counterparty =
    (targetType: 'valet' | 'washer') => (c: { userId: string; name: string | null }) => ({
      targetType,
      targetId: c.userId,
      name: reviewerDisplayName(c.name),
      reviewed: reviewed.has(c.userId),
    });

  return {
    bookingId: bookingIdSchema.parse(booking.id),
    spaceTitle: booking.spaceTitle,
    completedAt: completedAt.toISOString(),
    reviewableUntil: new Date(completedAt.getTime() + REVIEW_WINDOW_MS).toISOString(),
    targets: [
      // An owner who booked their own listing cannot review it (SELF_REVIEW), so it is not offered.
      ...(booking.ownerId === booking.driverId
        ? []
        : [
            {
              targetType: 'space' as const,
              targetId: booking.spaceId,
              name: booking.spaceTitle,
              reviewed: reviewed.has(booking.spaceId),
            },
          ]),
      ...valets.map(counterparty('valet')),
      ...washers.map(counterparty('washer')),
    ],
  };
}
