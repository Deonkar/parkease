import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  bookingReceivableEntries,
  receivableTotalsOf,
  reverseEntries,
} from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { BookingEvent, assertTransition } from '../lifecycle.js';

export interface CancelBookingInput {
  readonly bookingId: string;
  readonly driverId: string;
  readonly reason: string | null;
}

@Injectable()
export class CancelBookingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly availability: AvailabilityService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Until payment capture exists (task 9), no booking can reach a state where
   * money has actually been collected, so every cancellation here reverses the
   * receivable in full. prd.md §8's partial refund tiers belong with the captured
   * money that makes them meaningful; writing them now would be tier arithmetic
   * against a balance that is always zero.
   *
   * What is already true and tested: the slot is released, the ledger nets to
   * zero, and the second cancel is refused by the lifecycle guard rather than
   * writing a second reversal.
   */
  async execute(input: CancelBookingInput) {
    const booking = await this.bookings.findOwnedByDriver(input.bookingId, input.driverId);
    // 404, not 403: confirming that someone else's booking exists is itself a leak.
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    const nextStatus = assertTransition(booking.status, BookingEvent.CANCEL);

    return withTransaction(this.db, async (tx) => {
      const cancelled = await this.bookings.markCancelled(tx, booking.id, nextStatus, input.reason);

      // A status change, not a delete: the row leaves the exclusion constraint's
      // predicate, so the slot_index is allocatable again the moment this commits.
      await this.availability.release(tx, booking.id);

      await this.ledger.post(tx, {
        bookingId: booking.id,
        counterpartyUserId: booking.driverId,
        entries: reverseEntries(
          bookingReceivableEntries(receivableTotalsOf(booking)),
          'booking cancelled by driver',
        ),
      });

      await this.outbox.enqueue(tx, {
        type: 'booking.cancelled',
        payload: {
          bookingId: booking.id,
          driverId: booking.driverId,
          spaceId: booking.spaceId,
          reason: input.reason,
        },
      });

      return cancelled;
    });
  }
}
