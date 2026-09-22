import { Inject, Injectable } from '@nestjs/common';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { AuditService } from '../../../platform/observability/audit.service.js';
import { logger } from '../../../platform/observability/logger.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { BookingService } from '../../booking/booking.service.js';
import { BookingEvent, assertTransition } from '../../booking/lifecycle.js';
import { AmountMismatchError } from '../errors.js';
import { PaymentService } from '../payment.service.js';
import { RAZORPAY, type RazorpayClient } from '../razorpay.client.js';

export interface ConfirmPaymentInput {
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly method: string | null;
}

export type ConfirmPaymentResult =
  | { readonly outcome: 'confirmed'; readonly bookingId: string }
  /** Already confirmed. The other of the callback / webhook pair got here first. */
  | { readonly outcome: 'replayed'; readonly bookingId: string }
  /** Captured against a booking that is no longer live. Needs refunding. */
  | { readonly outcome: 'orphaned'; readonly bookingId: string }
  /** A car wash add-on captured. Nothing about the booking changes (§13.4). */
  | { readonly outcome: 'carwash_captured'; readonly washJobId: string }
  /** Captured against an order we have no row for. Task 16 reconciles it. */
  | { readonly outcome: 'unknown_order' };

@Injectable()
export class ConfirmPaymentCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(RAZORPAY) private readonly razorpay: RazorpayClient,
    private readonly payments: PaymentService,
    private readonly bookings: BookingService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The single path from "Razorpay captured money" to "this booking is
   * confirmed", reached from both the Checkout callback and the webhook.
   *
   * Idempotent by construction, in two layers. The webhook claims the event id
   * before calling here; and this re-reads the booking under a row lock and
   * returns early if it is no longer `pending_payment`. Belt and braces is
   * correct — it is the only path that credits an owner.
   */
  async execute(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
    const existing = await this.payments.findByOrderId(input.razorpayOrderId);
    if (existing === undefined) return { outcome: 'unknown_order' };

    // Outside the transaction: it is a call to an external service (R-BE-04),
    // and it must happen before we commit anything the capture would justify.
    const capturedPaise = await this.verifyAmount(existing);

    return withTransaction(this.db, async (tx) => {
      const locked = await this.payments.findByOrderIdForUpdate(tx, input.razorpayOrderId);
      if (locked === undefined) return { outcome: 'unknown_order' };

      const { payment, booking } = locked;

      /**
       * A car wash add-on, not the parking. §13.4.
       *
       * Branching here rather than further down is the whole point: everything
       * below this line is about the booking's own lifecycle, and none of it is
       * true for a wash. The booking is already `active` when a wash is
       * requested, so without this branch the `!== 'pending_payment'` test
       * beneath would read a perfectly good capture as an orphan and enqueue a
       * refund of money the driver meant to spend.
       *
       * Nothing about the booking changes, and no ledger entry is posted: the
       * wash's receivable and its three credits went on the books when a
       * partner accepted, and capture moves where the money sits rather than
       * who owes whom — exactly as it does for a booking.
       */
      if (payment.purpose === 'carwash') {
        // `payments_wash_job_coherence_check` makes this non-null for every
        // 'carwash' row. If it is null the constraint has been bypassed, and a
        // capture we cannot attribute to a job is worth failing loudly over
        // rather than defaulting past (R-FAIL-01).
        if (payment.washJobId === null) {
          throw new Error(
            `Payment ${payment.id} is a car wash payment with no wash_job_id; ` +
              'payments_wash_job_coherence_check should have made this unreachable',
          );
        }

        // The callback and the webhook both land here; whichever is second sees
        // the row already captured and does nothing.
        if (payment.status !== 'captured') {
          await this.payments.markCaptured(tx, payment.id, {
            razorpayPaymentId: input.razorpayPaymentId,
            capturedPaise,
            method: input.method,
            at: new Date(),
          });
        }

        return { outcome: 'carwash_captured', washJobId: payment.washJobId };
      }

      if (booking.status !== 'pending_payment') {
        // Two shapes hide here, and they need opposite answers. `confirmed`
        // means the other delivery beat us and there is nothing to do.
        // Anything else means the expiry job released the slot while the driver
        // was paying — we are holding money for a booking that no longer
        // exists, and it has to go back.
        if (booking.status === 'confirmed' && payment.status === 'captured') {
          return { outcome: 'replayed', bookingId: booking.id };
        }

        await this.outbox.enqueue(tx, {
          type: 'payment.orphan-capture',
          payload: {
            bookingId: booking.id,
            paymentId: payment.id,
            razorpayPaymentId: input.razorpayPaymentId,
            capturedPaise,
            bookingStatus: booking.status,
          },
        });

        return { outcome: 'orphaned', bookingId: booking.id };
      }

      const nextStatus = assertTransition(booking.status, BookingEvent.PAY);

      await this.payments.markCaptured(tx, payment.id, {
        razorpayPaymentId: input.razorpayPaymentId,
        capturedPaise,
        method: input.method,
        at: new Date(),
      });

      await this.bookings.markStatus(tx, booking.id, nextStatus);

      // No ledger entry. The receivable and its three credits were posted when
      // the booking was created (task 8), and the ledger records obligations
      // between parties rather than cash: capture does not change who owes whom,
      // it changes where the money is sitting. The cash side — gateway fees and
      // the settlement clearing entries — is posted by task 16's reconciliation
      // job from Route's settlement reports.
      //
      // This is also why redelivery is safe to the paisa: there is nothing here
      // to post twice.

      await this.outbox.enqueue(
        tx,
        {
          type: 'booking.confirmed',
          payload: {
            bookingId: booking.id,
            driverId: booking.driverId,
            spaceId: booking.spaceId,
          },
        },
        {
          type: 'booking.complete',
          payload: { bookingId: booking.id },
          availableAt: booking.endsAt,
        },
      );

      return { outcome: 'confirmed', bookingId: booking.id };
    });
  }

  /**
   * Re-fetches the order from Razorpay and compares it, in integer paise, with
   * `===` and no tolerance.
   *
   * Never against an amount that arrived from a client: v1 trusted the amount
   * Checkout posted back, which is a number the client controls. The comparison
   * is against `expected_total_paise`, written at order creation from the
   * booking row (R-SEC-09).
   */
  private async verifyAmount(payment: {
    id: string;
    bookingId: string;
    userId: string;
    razorpayOrderId: string;
    expectedTotalPaise: number;
  }): Promise<number> {
    const order = await this.razorpay.fetchOrder(payment.razorpayOrderId);

    if (order.amountPaidPaise !== payment.expectedTotalPaise) {
      // A mismatch is a security event, not a warning, and it is recorded even
      // though the confirmation aborts — so it gets its own transaction rather
      // than riding one that is about to roll back.
      await withTransaction(this.db, async (tx) => {
        await this.audit.record(tx, {
          actorUserId: null,
          actorRole: null,
          action: 'payment.amount_mismatch',
          targetType: 'booking',
          targetId: payment.bookingId,
          after: {
            expectedPaise: payment.expectedTotalPaise,
            capturedPaise: order.amountPaidPaise,
          },
          ipAddress: null,
        });
      });

      // Booking id only — enough to find the booking, nothing that identifies
      // the movement of money. The Pino redact list also covers the Razorpay
      // ids, but only because this pass added them: the comment that used to
      // sit here claimed they were already redacted, and they were not.
      logger.error(
        { bookingId: payment.bookingId, expectedPaise: payment.expectedTotalPaise },
        'payment amount mismatch',
      );

      throw new AmountMismatchError();
    }

    return order.amountPaidPaise;
  }
}
