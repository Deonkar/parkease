import { bookings, outboxMessages, spaces } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { parseBookingJobPayload } from './payload.js';

/**
 * The "Parking in 30 min ⏰" nudge (website.md §5), fired half an hour before
 * `starts_at`.
 *
 * Idempotent, and guarded on status rather than on a sent-flag: a booking that
 * has since been cancelled or expired must not be reminded about, and a
 * redelivery of the same job must not send twice. The enqueue is what this
 * writes; `notification.dispatch` owns delivery (task 19).
 */
export async function remindBooking(deps: JobDeps, raw: unknown): Promise<void> {
  const { bookingId } = parseBookingJobPayload(raw);

  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ booking: bookings, spaceTitle: spaces.title })
      .from(bookings)
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(eq(bookings.id, bookingId))
      .for('update', { of: bookings });

    if (row === undefined) {
      logger.warn({ bookingId }, 'remind: booking no longer exists');
      return;
    }

    // Only a booking that is actually going to happen. `pending_payment` is
    // excluded on purpose: reminding someone about a booking they have not paid
    // for, minutes before the hold lapses, is worse than saying nothing.
    if (row.booking.status !== 'confirmed') {
      logger.info(
        { bookingId, status: row.booking.status },
        'remind: not confirmed, skipping the nudge',
      );
      return;
    }

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: row.booking.driverId,
        type: 'booking_reminder',
        title: 'Parking in 30 min ⏰',
        body: `Your spot at ${row.spaceTitle} is ready soon.`,
        data: { bookingId },
      },
    });

    logger.info({ bookingId }, 'remind: reminder enqueued');
  });
}
