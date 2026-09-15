import {
  bookingReceivableEntries,
  receivableTotalsOf,
  reverseEntries,
} from '@parkease/contracts/money';
import { uuidv7 } from '@parkease/db/id';
import { bookings, bookingSlots, outboxMessages } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { postLedger } from './ledger.js';
import { parseBookingJobPayload } from './payload.js';

/**
 * Releases a booking nobody paid for, ten minutes after it was made.
 *
 * Idempotent by guard rather than by bookkeeping: delivery is at-least-once
 * (R-ASYNC-03), so a second delivery — or a booking that has since been paid or
 * cancelled — must be a no-op, not an error. The row is locked FOR UPDATE first,
 * so two concurrent deliveries cannot both read `pending_payment` and both
 * write a reversal.
 */
export async function expireUnpaid(deps: JobDeps, raw: unknown): Promise<void> {
  const { bookingId } = parseBookingJobPayload(raw);

  await deps.db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for('update');

    if (booking === undefined) {
      logger.warn({ bookingId }, 'expire-unpaid: booking no longer exists');
      return;
    }

    if (booking.status !== 'pending_payment') {
      logger.info(
        { bookingId, status: booking.status },
        'expire-unpaid: already resolved, nothing to do',
      );
      return;
    }

    await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: 'payment_timeout',
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    // A status change, not a delete: the row drops out of the exclusion
    // constraint's predicate, so the slot_index is allocatable for that exact
    // window the instant this commits. No cleanup sweep, no tombstones.
    await tx
      .update(bookingSlots)
      .set({ status: 'released', updatedAt: new Date() })
      .where(eq(bookingSlots.bookingId, bookingId));

    // Reverses the receivable posted at creation, composed from the booking's
    // own columns so an extended booking reverses what it actually accrued. The
    // composition is the same function the API uses — a second copy here is a
    // second place for the fee model to drift.
    const txnId = uuidv7();
    await postLedger(tx, {
      txnId,
      bookingId,
      counterpartyUserId: booking.driverId,
      entries: reverseEntries(
        bookingReceivableEntries(receivableTotalsOf(booking)),
        'booking expired: payment timeout',
      ),
    });

    await tx.insert(outboxMessages).values({
      type: 'booking.expired',
      payload: { bookingId, driverId: booking.driverId, spaceId: booking.spaceId },
    });

    logger.info({ bookingId, txnId }, 'expire-unpaid: booking released');
  });
}
