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
import { BookingEvent, IllegalBookingTransitionError, assertTransition } from '../lifecycle.js';

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
    return this.run(input);
  }

  /**
   * One path for both callers, so they lock in one order and check the transition on one row.
   *
   * A driver's ownership is checked first, outside the transaction, so a stranger's request
   * answers 404 without ever taking a lock on someone else's booking.
   *
   * Inside, both reads are locks: payment first, booking second — the order `AdminRefundCommand`
   * and payment capture take, so no two of them can deadlock. The transition is checked on the
   * locked row, and `markCancelled` is a compare-and-set on that status besides, so two
   * cancellations racing (driver and admin, or a driver's double tap under two idempotency keys)
   * produce one cancellation and one 409 — never two refunds.
   */
  private async run(input: CancelBookingInput): Promise<CancelBookingResult> {
    const { by } = input;
    if (by.kind === 'driver') {
      const owned = await this.bookings.findOwnedByDriver(input.bookingId, by.driverId);
      // 404, not 403: confirming that someone else's booking exists is itself a leak.
      if (owned === undefined) throw new NotFoundException('That booking does not exist.');
    }
    const at = new Date();

    return withTransaction(this.db, async (tx) => {
      const payment = await this.payments.lockCapturedForBooking(tx, input.bookingId);
      const booking = await this.bookings.findForUpdate(tx, input.bookingId);
      if (
        booking === undefined ||
        booking.deletedAt !== null ||
        (by.kind === 'driver' && booking.driverId !== by.driverId)
      ) {
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
        at,
        reason: input.reason,
        cancelledBy: by.kind,
      });

      if (by.kind === 'admin') {
        await this.audit.record(tx, {
          actorUserId: by.actor.userId,
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
          ipAddress: by.actor.ipAddress,
        });
      }

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
      { from: booking.status, to: input.nextStatus },
      input.reason,
    );
    // The row moved since it was read: someone else cancelled (or checked in) first. Refused
    // here, inside the transaction and before any refund is written.
    if (cancelled === undefined) {
      throw new IllegalBookingTransitionError(booking.status, BookingEvent.CANCEL);
    }

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
