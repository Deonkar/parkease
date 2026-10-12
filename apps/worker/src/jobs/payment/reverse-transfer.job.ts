import { routeReversalEntries } from '@parkease/contracts/money';
import type { Transaction } from '@parkease/db';
import { bookings, payments, refunds, washJobs } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

import {
  PAYMENT_REVERSE_TRANSFER_JOB,
  parsePaymentJobPayload,
  reverseTransferPayloadSchema,
} from './payload.js';
import { razorpayReversals, type ReversalGateway } from './razorpay.js';

/**
 * Takes a refund's partner share back from the Route transfer that paid it at capture (S-98).
 *
 * The refund's own posting already debited `owner_payable` for that share, so until this runs the
 * partner owes it to us. It is chained after `payment.issue-refund` rather than ahead of it: the
 * driver's money never waits on a partner's Linked Account balance. A reversal Razorpay refuses
 * (the partner already settled the money out) throws, and pg-boss retries it; the payable stays
 * owed in the ledger and the weekly payout nets it, so nothing is lost while it waits.
 *
 * Idempotent like `issue-refund`: the row is locked, `route_reversal_id` set means done, and a
 * reversal already carrying this refund's id is adopted, never made twice.
 */
export async function reverseTransfer(
  deps: JobDeps,
  raw: unknown,
  gateway: ReversalGateway = razorpayReversals,
): Promise<void> {
  const { refundId } = parsePaymentJobPayload(
    reverseTransferPayloadSchema,
    raw,
    PAYMENT_REVERSE_TRANSFER_JOB,
  );

  const target = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        reversalPaise: refunds.routeReversalPaise,
        reversalId: refunds.routeReversalId,
        paymentId: payments.id,
        bookingId: payments.bookingId,
        razorpayPaymentId: payments.razorpayPaymentId,
        washJobId: payments.washJobId,
      })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(eq(refunds.id, refundId))
      .for('update', { of: refunds });

    if (row === undefined) throw new Error(`Refund ${refundId} does not exist`);
    if (row.reversalPaise === null || row.reversalId !== null) return null;
    if (row.razorpayPaymentId === null) {
      throw new Error(`Refund ${refundId} has a reversal but its payment was never captured`);
    }
    return { ...row, reversalPaise: row.reversalPaise, razorpayPaymentId: row.razorpayPaymentId };
  });

  if (target === null) {
    logger.info({ refundId }, 'reverse-transfer: nothing to reverse');
    return;
  }

  // Outside any transaction: a gateway call never holds a row lock (R-BE-04).
  const transfers = await gateway.transfersFor(target.razorpayPaymentId);
  const transfer = transfers.find((t) => t.status !== 'failed');
  if (transfer === undefined) {
    throw new Error(`Refund ${refundId}: payment ${target.razorpayPaymentId} has no transfer`);
  }

  const existing = await gateway.findByReference(transfer.id, refundId);
  if (existing !== null) {
    logger.warn({ refundId }, 'reverse-transfer: gateway already held this reversal, adopting it');
  }
  const reversal =
    existing ??
    (await gateway.reverse({
      transferId: transfer.id,
      amountPaise: target.reversalPaise,
      reference: refundId,
    }));

  await deps.db.transaction(async (tx) => {
    // A second delivery that raced us here finds the id set and posts nothing.
    const [claimed] = await tx
      .update(refunds)
      .set({ routeReversalId: reversal.id, updatedAt: new Date() })
      .where(and(eq(refunds.id, refundId), isNull(refunds.routeReversalId)))
      .returning({ id: refunds.id });
    if (claimed === undefined) return;

    await postLedger(tx, {
      bookingId: target.bookingId,
      paymentId: target.paymentId,
      entries: routeReversalEntries(
        reversal.amountPaise,
        await counterpartyFor(tx, target.washJobId, target.bookingId),
      ),
    });
  });

  logger.info({ refundId, reversalId: reversal.id }, 'reverse-transfer: partner share taken back');
}

/** Who the discharge at capture was stamped with, so the reversal lands on the same rows. */
async function counterpartyFor(
  tx: Transaction,
  washJobId: string | null,
  bookingId: string,
): Promise<string> {
  if (washJobId !== null) {
    const [job] = await tx
      .select({ washerUserId: washJobs.washerUserId })
      .from(washJobs)
      .where(eq(washJobs.id, washJobId));
    if (job?.washerUserId == null) throw new Error(`Wash job ${washJobId} has no partner`);
    return job.washerUserId;
  }
  const [booking] = await tx
    .select({ driverId: bookings.driverId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (booking === undefined) throw new Error(`Booking ${bookingId} does not exist`);
  return booking.driverId;
}
