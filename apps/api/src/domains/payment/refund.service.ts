import { Injectable } from '@nestjs/common';
import {
  bookingReceivableEntries,
  type CancelledBy,
  receivableTotalsOf,
  refundEntries,
  RefundTier,
  resolveRefund,
  reverseEntries,
} from '@parkease/contracts/money';

import type { TxHandle } from '../../platform/db/transaction.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

import { PaymentService } from './payment.service.js';

export interface RefundableBooking {
  readonly id: string;
  readonly driverId: string;
  readonly totalPaise: number;
  readonly ownerEarningsPaise: number;
  readonly parkeaseFeePaise: number;
  readonly gstPaise: number;
  readonly startsAt: Date;
}

export interface RefundablePayment {
  readonly id: string;
  readonly status: string;
  readonly razorpayPaymentId: string | null;
}

/**
 * What a cancellation actually did to the money.
 *
 * Deliberately not `extends RefundOutcome`: that type carries the policy
 * invariant `refundPaise + retainedPaise === totalPaise`, and the uncaptured
 * case below breaks it honestly rather than reporting a refund of money nobody
 * ever paid.
 */
export interface RefundApplied {
  readonly tier: RefundTier;
  /** What will actually reach the driver. Zero when nothing was ever captured. */
  readonly refundPaise: number;
  /** Our `refunds` row, when there is money to send back. */
  readonly refundId: string | null;
}

@Injectable()
export class RefundService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Resolves the published refund tier and writes everything it implies, inside
   * the caller's transaction.
   *
   * **Ledger first, money second, always in that order.** The reversing entries
   * and the `refunds` row commit here; the Razorpay call is an outbox message
   * the worker picks up afterwards. A crash between the two therefore leaves a
   * refund we owe and can retry — not money gone with no record of it, which is
   * the only one of the two failures a driver cannot be made whole from.
   *
   * Takes a `tx` rather than opening its own: a cancellation also changes the
   * booking's status and releases its slot, and a refund that commits without
   * them (or vice versa) is a booking whose money and whose state disagree
   * (R-BE-03).
   */
  async refundForCancellation(
    tx: TxHandle,
    input: {
      readonly booking: RefundableBooking;
      readonly payment: RefundablePayment | undefined;
      readonly at: Date;
      readonly cancelledBy: CancelledBy;
    },
  ): Promise<RefundApplied> {
    const { booking, payment, at, cancelledBy } = input;

    const outcome = resolveRefund({
      booking: { totalPaise: booking.totalPaise, startsAt: booking.startsAt },
      at,
      cancelledBy,
    });

    const totals = receivableTotalsOf(booking);

    // Nothing was ever collected, so there is nothing to refund — there is an
    // obligation to cancel. Reversing the original posting in full is what says
    // that: the driver owes nothing, the owner is due nothing, no tax arises.
    //
    // Running the tier logic here instead would credit `refunds_payable` for
    // money we never received and leave `driver_receivable` standing against a
    // driver who never paid — a liability and an asset both invented by a
    // cancellation. Reachable in production only through the expiry path, and
    // the honest answer is the same either way.
    if (payment === undefined || payment.razorpayPaymentId === null) {
      await this.ledger.post(tx, {
        bookingId: booking.id,
        counterpartyUserId: booking.driverId,
        entries: reverseEntries(
          bookingReceivableEntries(totals),
          'booking cancelled before any payment was captured',
        ),
      });

      return { tier: outcome.tier, refundPaise: 0, refundId: null };
    }

    const description = `refund: ${outcome.tier}`;
    const entries = refundEntries(totals, outcome, description);

    // `no_refund` composes to nothing, and an empty posting is legitimate rather
    // than a bug — the booking stands financially, so nothing moves. Posting it
    // would throw, because `assertEntriesBalance` rejects an empty set on
    // purpose (learnings.md).
    if (entries.length > 0) {
      await this.ledger.post(tx, {
        bookingId: booking.id,
        paymentId: payment.id,
        counterpartyUserId: booking.driverId,
        entries,
      });
    }

    if (outcome.refundPaise <= 0) {
      return { tier: outcome.tier, refundPaise: 0, refundId: null };
    }

    const refund = await this.payments.insertRefund(tx, {
      paymentId: payment.id,
      amountPaise: outcome.refundPaise,
      reason: outcome.tier,
    });

    if (refund === undefined) {
      // `.returning()` gave nothing back, which means the insert did not happen.
      // Failing loudly beats enqueueing a gateway call against a row that does
      // not exist (R-FAIL-01).
      throw new Error(`Refund row for payment ${payment.id} was not created`);
    }

    await this.payments.markRefunded(
      tx,
      payment.id,
      outcome.tier === RefundTier.OWNER_CANCELLED || outcome.refundPaise === booking.totalPaise,
    );

    await this.outbox.enqueue(tx, {
      type: 'payment.issue-refund',
      payload: {
        refundId: refund.id,
        paymentId: payment.id,
        bookingId: booking.id,
        razorpayPaymentId: payment.razorpayPaymentId,
        amountPaise: outcome.refundPaise,
      },
    });

    return { tier: outcome.tier, refundPaise: outcome.refundPaise, refundId: refund.id };
  }
}
