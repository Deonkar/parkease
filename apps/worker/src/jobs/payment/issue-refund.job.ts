import { refunds } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { issueRefundPayloadSchema, parsePaymentJobPayload } from './payload.js';
import { razorpayRefunds, type RefundGateway } from './razorpay.js';

/**
 * Calls Razorpay to actually send a refund back.
 *
 * The decision, the ledger reversal and the `refunds` row were all committed by
 * `RefundService` before this message existed. **Ledger first, money second** —
 * so a crash anywhere in here leaves a refund we owe and can retry, never money
 * gone with no record of it (R-ASYNC-01, R-BE-04).
 *
 * Idempotent in three layers, because delivery is at-least-once and a
 * double-refund is money we cannot get back:
 *
 *   1. The row is locked FOR UPDATE, so two deliveries cannot both proceed.
 *   2. `razorpay_refund_id` already set means a previous run finished.
 *   3. Razorpay is asked whether a refund already carries this refund's id,
 *      which covers the window where a run called the gateway and then died
 *      before writing the id down. That window is short and it is real.
 */
export async function issueRefund(
  deps: JobDeps,
  raw: unknown,
  gateway: RefundGateway = razorpayRefunds,
): Promise<void> {
  const payload = parsePaymentJobPayload(issueRefundPayloadSchema, raw, 'payment.issue-refund');

  const alreadyDone = await deps.db.transaction(async (tx) => {
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, payload.refundId))
      .for('update');

    if (refund === undefined) {
      // The outbox message committed with the row, so this cannot happen from
      // our own writes. It is loud rather than silent because the alternative
      // reading — someone deleted a refund row — is worth waking up for.
      throw new Error(`Refund ${payload.refundId} does not exist`);
    }

    return refund.razorpayRefundId !== null;
  });

  if (alreadyDone) {
    logger.info({ refundId: payload.refundId }, 'issue-refund: already sent, nothing to do');
    return;
  }

  // Outside the transaction, always: an external call inside one holds a row
  // lock for the length of somebody else's network (R-BE-04).
  const existing = await gateway.findByReference(payload.razorpayPaymentId, payload.refundId);

  const issued =
    existing ??
    (await gateway.create({
      paymentId: payload.razorpayPaymentId,
      amountPaise: payload.amountPaise,
      reference: payload.refundId,
      bookingId: payload.bookingId,
    }));

  if (existing !== null) {
    logger.warn(
      { refundId: payload.refundId },
      'issue-refund: gateway already held this refund, adopting it rather than sending a second',
    );
  }

  await deps.db.transaction(async (tx) => {
    await tx
      .update(refunds)
      .set({ razorpayRefundId: issued.id, updatedAt: new Date() })
      .where(eq(refunds.id, payload.refundId));
  });

  // No ledger write here. `refunds_payable` was credited when we committed to
  // refunding; it is discharged against `driver_receivable` only when Razorpay
  // says the money moved, which arrives as `refund.processed`.
  logger.info(
    { refundId: payload.refundId, bookingId: payload.bookingId },
    'issue-refund: sent to gateway',
  );
}
