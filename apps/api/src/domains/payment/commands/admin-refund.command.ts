import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminRefund } from '@parkease/contracts/admin';
import { proportionalRefundEntries, receivableTotalsOf } from '@parkease/contracts/money';
import { type Paise, subPaise } from '@parkease/contracts/primitives';
import { bookings } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { type AdminActor, AuditService } from '../../../platform/observability/audit.service.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { BookingNotSettledError, NoCapturedPaymentError } from '../errors.js';
import { PaymentService } from '../payment.service.js';
import { isAdminRefundable, refundableOf, resolveAdminRefund } from '../refund-options.js';

export interface AdminRefundResult {
  readonly refundId: string;
  readonly amountPaise: Paise;
  readonly refundablePaiseAfter: Paise;
}

/** The posting's description, and the `refunds.reason` the row carries. */
const ADMIN_REFUND_REASON = 'admin';

/**
 * Task 18a: an admin refunds part or all of what a finished booking's driver paid.
 *
 * One transaction, and its first statement is the payment lock. Everything after it — what is
 * left to refund, the amount, the ledger posting, the `refunds` row, the payment's status, the
 * outbox message and the audit row — is decided by whoever holds that lock, so two admins
 * refunding the same booking at once serialise: the second reads the first's refund and is
 * refused if the balance no longer covers it. Every refusal throws inside the transaction, so a
 * refused refund writes nothing.
 *
 * Ledger first, money second: the gateway call is the worker's `payment.issue-refund` job, with
 * the same payload `RefundService` enqueues, after this commits (R-BE-04).
 */
@Injectable()
export class AdminRefundCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  execute(bookingId: string, input: AdminRefund, actor: AdminActor): Promise<AdminRefundResult> {
    return withTransaction(this.db, async (tx) => {
      const payment = await this.payments.lockCapturedForBooking(tx, bookingId);

      // Read after the lock, by the id the database holds rather than the path string.
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, payment?.bookingId ?? bookingId), isNull(bookings.deletedAt)));
      if (booking === undefined) throw new NotFoundException('That booking does not exist.');
      if (payment === undefined) throw new NoCapturedPaymentError();
      if (!isAdminRefundable(booking.status)) throw new BookingNotSettledError();

      // The lock query requires both; the columns are nullable, so the compiler cannot know.
      if (payment.capturedPaise === null || payment.razorpayPaymentId === null) {
        throw new Error(`Captured payment ${payment.id} has no captured amount or gateway id`);
      }

      const prior = await this.payments.refundsFor(tx, payment.id);
      const refundablePaise = refundableOf(payment.capturedPaise, prior);
      const amountPaise = resolveAdminRefund(input, refundablePaise);
      const refundedBeforePaise = prior.reduce((sum, r) => sum + r.amountPaise, 0);

      await this.ledger.post(tx, {
        bookingId: booking.id,
        paymentId: payment.id,
        counterpartyUserId: booking.driverId,
        entries: proportionalRefundEntries(
          receivableTotalsOf(booking),
          amountPaise,
          `refund: ${ADMIN_REFUND_REASON}`,
        ),
      });

      const refund = await this.payments.insertRefund(tx, {
        paymentId: payment.id,
        amountPaise,
        reason: ADMIN_REFUND_REASON,
      });
      // `.returning()` gave nothing back, so the insert did not happen: never enqueue a gateway
      // call against a row that does not exist (R-FAIL-01).
      if (refund === undefined)
        throw new Error(`Refund row for payment ${payment.id} was not created`);

      await this.payments.markRefunded(tx, payment.id, amountPaise === refundablePaise);

      await this.outbox.enqueue(tx, {
        type: 'payment.issue-refund',
        payload: {
          refundId: refund.id,
          paymentId: payment.id,
          bookingId: booking.id,
          razorpayPaymentId: payment.razorpayPaymentId,
          amountPaise,
        },
      });

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: 'booking.refund',
        targetType: 'booking',
        targetId: booking.id,
        before: { refundedPaise: refundedBeforePaise },
        after: {
          refundedPaise: refundedBeforePaise + amountPaise,
          amountPaise,
          option: input.option,
          reason: input.reason,
        },
        ipAddress: actor.ipAddress,
      });

      return {
        refundId: refund.id,
        amountPaise,
        refundablePaiseAfter: subPaise(refundablePaise, amountPaise),
      };
    });
  }
}
