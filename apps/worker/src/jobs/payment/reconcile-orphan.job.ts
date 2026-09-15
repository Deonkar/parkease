import { LedgerAccount } from '@parkease/contracts/enums';
import type { LedgerEntryDraft } from '@parkease/contracts/money';
import { outboxMessages, payments, refunds } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

import { orphanCapturePayloadSchema, parsePaymentJobPayload } from './payload.js';

/**
 * A capture that landed against a booking which no longer exists.
 *
 * It happens for a real and unavoidable reason: the driver was inside Razorpay
 * Checkout when the ten-minute hold expired, the expiry job released their slot,
 * and the money arrived anyway. Nobody did anything wrong, and we are holding
 * cash for nothing. It goes back in full.
 *
 * The booking's receivable was already reversed when it was cancelled, so its
 * ledger nets to zero. This posting re-opens the pair the capture actually
 * created — we hold their money (`driver_receivable`) and we owe it back
 * (`refunds_payable`) — and `refund.processed` closes both. Skipping it would
 * mean a refund leaving the platform with no entry anywhere explaining why.
 */
export async function reconcileOrphanCapture(deps: JobDeps, raw: unknown): Promise<void> {
  const payload = parsePaymentJobPayload(orphanCapturePayloadSchema, raw, 'payment.orphan-capture');

  await deps.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, payload.paymentId))
      .for('update');

    if (payment === undefined) {
      logger.warn({ paymentId: payload.paymentId }, 'orphan-capture: payment row is gone');
      return;
    }

    // Idempotence by guard: a second delivery finds the refund we already
    // created and stops, rather than refunding the driver twice.
    const [existing] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), eq(refunds.reason, 'orphan_capture')));

    if (existing !== undefined) {
      logger.info(
        { paymentId: payment.id, bookingId: payload.bookingId },
        'orphan-capture: refund already recorded',
      );
      return;
    }

    const entries: readonly LedgerEntryDraft[] = [
      {
        account: LedgerAccount.DRIVER_RECEIVABLE,
        direction: 'debit',
        amountPaise: payload.capturedPaise,
        description: 'capture against a booking that no longer exists',
      },
      {
        account: LedgerAccount.REFUNDS_PAYABLE,
        direction: 'credit',
        amountPaise: payload.capturedPaise,
        description: 'capture against a booking that no longer exists',
      },
    ];

    await postLedger(tx, {
      bookingId: payload.bookingId,
      counterpartyUserId: payment.userId,
      entries,
    });

    const [refund] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.id,
        amountPaise: payload.capturedPaise,
        reason: 'orphan_capture',
        status: 'pending',
      })
      .returning({ id: refunds.id });

    if (refund === undefined) {
      throw new Error(`Refund row for orphan capture on payment ${payment.id} was not created`);
    }

    await tx
      .update(payments)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    // Ledger first, money second — the gateway call is the next job, committed
    // in the same transaction as the rows that justify it.
    await tx.insert(outboxMessages).values({
      type: 'payment.issue-refund',
      payload: {
        refundId: refund.id,
        paymentId: payment.id,
        bookingId: payload.bookingId,
        razorpayPaymentId: payload.razorpayPaymentId,
        amountPaise: payload.capturedPaise,
      },
    });

    logger.warn(
      { bookingId: payload.bookingId, bookingStatus: payload.bookingStatus },
      'orphan-capture: refunding a capture with no live booking',
    );
  });
}
