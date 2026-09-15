import { bookings, bookingSlots, outboxMessages } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { parseBookingJobPayload } from './payload.js';

/**
 * Moves a checked-in booking to `completed` when its window ends, releasing the
 * slot and prompting for a review.
 *
 * Scheduled at check-in rather than at creation, deliberately: a booking nobody
 * ever arrived for must not quietly complete itself, because "completed" is what
 * a payout is eventually computed from.
 *
 * No ledger entry. Completion settles nothing — the receivable was posted at
 * creation and the owner's payable was credited then. Money moves at capture
 * and at payout, which are task 9 and task 16.
 */
export async function completeBooking(deps: JobDeps, raw: unknown): Promise<void> {
  const { bookingId } = parseBookingJobPayload(raw);

  await deps.db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');

    if (booking === undefined) {
      logger.warn({ bookingId }, 'complete: booking no longer exists');
      return;
    }

    // Idempotent by guard. A redelivery, or a booking cancelled mid-stay, is a
    // no-op — `active` is the only status `complete` is legal from.
    if (booking.status !== 'active') {
      logger.info({ bookingId, status: booking.status }, 'complete: not active, nothing to do');
      return;
    }

    const now = new Date();

    await tx
      .update(bookings)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(bookings.id, bookingId));

    await tx
      .update(bookingSlots)
      .set({ status: 'released', updatedAt: now })
      .where(eq(bookingSlots.bookingId, bookingId));

    await tx.insert(outboxMessages).values({
      type: 'booking.completed',
      payload: { bookingId, driverId: booking.driverId, spaceId: booking.spaceId },
    });

    logger.info({ bookingId }, 'complete: booking completed and slot released');
  });
}
