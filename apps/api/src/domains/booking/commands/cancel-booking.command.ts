import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CancelledBy, RefundTier } from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { RefundService } from '../../payment/refund.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { BookingEvent, assertTransition } from '../lifecycle.js';

export interface CancelBookingInput {
  readonly bookingId: string;
  readonly driverId: string;
  readonly reason: string | null;
}

export interface CancelBookingResult {
  readonly booking: Awaited<ReturnType<BookingService['markCancelled']>>;
  readonly refundPaise: number;
  readonly refundTier: RefundTier;
}

@Injectable()
export class CancelBookingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Cancels a booking and refunds whatever the published tier says is due.
   *
   * The lifecycle table admits `cancel` only from `confirmed` and `active`, so
   * by the time this runs the driver has paid — which is what makes the tiers in
   * `prd.md` §8 meaningful rather than arithmetic against a zero balance. A
   * `pending_payment` booking is released by the expiry job instead.
   *
   * Everything commits together: the status change, the slot release, the ledger
   * reversal, the refund row and the outbox message that will call Razorpay.
   * The gateway call itself is not in here — ledger first, money second
   * (R-BE-04, R-ASYNC-01).
   */
  async execute(input: CancelBookingInput): Promise<CancelBookingResult> {
    const booking = await this.bookings.findOwnedByDriver(input.bookingId, input.driverId);
    // 404, not 403: confirming that someone else's booking exists is itself a leak.
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    const nextStatus = assertTransition(booking.status, BookingEvent.CANCEL);

    // Read before the transaction opens: it is a plain lookup, and keeping it
    // out keeps the transaction to the writes that must commit together.
    const payment = await this.payments.findLatestCapturedForBooking(booking.id);
    const cancelledBy: CancelledBy = 'driver';
    const at = new Date();

    return withTransaction(this.db, async (tx) => {
      const cancelled = await this.bookings.markCancelled(tx, booking.id, nextStatus, input.reason);

      // A status change, not a delete: the row leaves the exclusion constraint's
      // predicate, so the slot_index is allocatable again the moment this commits.
      await this.availability.release(tx, booking.id);

      const refund = await this.refunds.refundForCancellation(tx, {
        booking,
        payment,
        at,
        cancelledBy,
      });

      await this.outbox.enqueue(tx, {
        type: 'booking.cancelled',
        payload: {
          bookingId: booking.id,
          driverId: booking.driverId,
          spaceId: booking.spaceId,
          reason: input.reason,
          refundPaise: refund.refundPaise,
          refundTier: refund.tier,
        },
      });

      return {
        booking: cancelled,
        refundPaise: refund.refundPaise,
        refundTier: refund.tier,
      };
    });
  }
}
