import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BookingStatus } from '@parkease/contracts/enums';
import type { CancelledBy, RefundTier } from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { type TxHandle, withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { type RefundablePayment, RefundService } from '../../payment/refund.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { BookingEvent, assertTransition } from '../lifecycle.js';

/**
 * Who is cancelling. A driver reaches only their own bookings; an admin reaches any booking, and
 * the cancellation is audited under their name.
 */
export type CancelledByActor =
  | { readonly kind: 'driver'; readonly driverId: string }
  | { readonly kind: 'admin'; readonly actor: AdminActor };

export interface CancelBookingInput {
  readonly bookingId: string;
  readonly reason: string | null;
  readonly by: CancelledByActor;
}

export interface CancelBookingResult {
  readonly booking: Awaited<ReturnType<BookingService['markCancelled']>>;
  readonly refundPaise: number;
  readonly refundTier: RefundTier;
}

type Booking = NonNullable<Awaited<ReturnType<BookingService['findForUpdate']>>>;

@Injectable()
export class CancelBookingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly availability: AvailabilityService,
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
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
   * reversal, the refund row and the outbox message that will call Razorpay —
   * and, for an admin, the audit row. The gateway call itself is not in here —
   * ledger first, money second (R-BE-04, R-ASYNC-01).
   */
  execute(input: CancelBookingInput): Promise<CancelBookingResult> {
    return input.by.kind === 'driver'
      ? this.asDriver(input, input.by.driverId)
      : this.asAdmin(input, input.by.actor);
  }

  private async asDriver(input: CancelBookingInput, driverId: string) {
    const booking = await this.bookings.findOwnedByDriver(input.bookingId, driverId);
    // 404, not 403: confirming that someone else's booking exists is itself a leak.
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    const nextStatus = assertTransition(booking.status, BookingEvent.CANCEL);

    // Read before the transaction opens: it is a plain lookup, and keeping it
    // out keeps the transaction to the writes that must commit together.
    const payment = await this.payments.findLatestCapturedForBooking(booking.id);
    const at = new Date();

    return withTransaction(this.db, (tx) =>
      this.cancel(tx, {
        booking,
        nextStatus,
        payment,
        at,
        reason: input.reason,
        cancelledBy: 'driver',
      }),
    );
  }

  /**
   * Any booking, by id. Both reads are locks inside the transaction, payment first and booking
   * second — the order `AdminRefundCommand` and payment capture take, so the three cannot deadlock
   * one another. The transition is checked on the locked row, so two admins cancelling at once
   * get one cancellation and one 409, and only one audit row.
   */
  private asAdmin(input: CancelBookingInput, actor: AdminActor) {
    return withTransaction(this.db, async (tx) => {
      const payment = await this.payments.lockCapturedForBooking(tx, input.bookingId);
      const booking = await this.bookings.findForUpdate(tx, input.bookingId);
      if (booking === undefined || booking.deletedAt !== null) {
        throw new NotFoundException('That booking does not exist.');
      }

      const nextStatus = assertTransition(booking.status, BookingEvent.CANCEL);

      // A live booking's payment is untouched: admin refunds are refused until a booking is over
      // (`isAdminRefundable`). Anything else would be refunded in full a second time, so it
      // fails loudly instead (R-FAIL-01).
      if (payment !== undefined && payment.status !== 'captured') {
        throw new Error(`Booking ${booking.id} is live but its payment is ${payment.status}`);
      }

      const result = await this.cancel(tx, {
        booking,
        nextStatus,
        payment,
        at: new Date(),
        reason: input.reason,
        cancelledBy: 'admin',
      });

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: 'booking.cancel',
        targetType: 'booking',
        targetId: booking.id,
        before: { status: booking.status },
        after: {
          status: nextStatus,
          reason: input.reason,
          refundPaise: result.refundPaise,
          refundTier: result.refundTier,
        },
        ipAddress: actor.ipAddress,
      });

      return result;
    });
  }

  private async cancel(
    tx: TxHandle,
    input: {
      readonly booking: Booking;
      readonly nextStatus: BookingStatus;
      readonly payment: RefundablePayment | undefined;
      readonly at: Date;
      readonly reason: string | null;
      readonly cancelledBy: CancelledBy;
    },
  ): Promise<CancelBookingResult> {
    const { booking, payment, at, cancelledBy } = input;

    const cancelled = await this.bookings.markCancelled(
      tx,
      booking.id,
      input.nextStatus,
      input.reason,
    );

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
  }
}
