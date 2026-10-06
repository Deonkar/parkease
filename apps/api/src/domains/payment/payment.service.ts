import { Inject, Injectable } from '@nestjs/common';
import type { PaymentStatus } from '@parkease/contracts/enums';
import { bookings, linkedAccounts, payments, refunds, spaces, washJobs } from '@parkease/db/schema';
import { and, desc, eq, inArray, isNotNull, notExists } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

export interface InsertPaymentInput {
  readonly bookingId: string;
  readonly userId: string;
  readonly razorpayOrderId: string;
  readonly expectedTotalPaise: number;
  /** Omitted means a parking booking, which is what every task-9 caller is. */
  readonly purpose?: 'booking' | 'carwash';
  readonly washJobId?: string;
  /** The Route transfer attached to the order; null when it carried none. */
  readonly routeTransferPaise: number | null;
}

/**
 * A payment whose money reached us, whatever has been refunded since. The admin refund lock and
 * the booking detail's refundable balance must pick the same payment, so they share this.
 */
export const CAPTURED_PAYMENT_STATUSES: PaymentStatus[] = [
  'captured',
  'partially_refunded',
  'refunded',
];

/**
 * The `refunds.reason` the worker's `reconcile-orphan.job.ts` writes when it refunds, in full, a
 * capture that landed with no live booking behind it (a late capture on a failed order, or the
 * loser of two concurrent create-order calls). That payment is marked `refunded` with a fresh
 * `captured_at`, so it is the newest capture on the booking — and it is not the booking's money.
 * The worker cannot import from `apps/api`, so the literal lives in both places; change together.
 */
export const ORPHAN_CAPTURE_REFUND_REASON = 'orphan_capture';

/**
 * Every read and write against `payments`, `refunds` and `linked_accounts`.
 *
 * The commands own the transactions and the decisions; this owns the SQL. It
 * deliberately has no method that computes an amount — `domains/pricing` is the
 * only module that produces one (R-ARCH-06).
 */
@Injectable()
export class PaymentService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The owner's Linked Account for a space, only if KYC has actually activated
   * it. A `pending` account cannot receive a transfer, so treating it as usable
   * would produce a captured payment with no split — a manual payout nobody
   * scheduled, discovered when the owner's money does not arrive.
   */
  async activeLinkedAccountForSpace(spaceId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ razorpayAccountId: linkedAccounts.razorpayAccountId })
      .from(spaces)
      .innerJoin(linkedAccounts, eq(linkedAccounts.userId, spaces.ownerId))
      .where(and(eq(spaces.id, spaceId), eq(linkedAccounts.kycStatus, 'activated')));

    return row?.razorpayAccountId;
  }

  /**
   * A partner's own Linked Account, by user id rather than through a space.
   *
   * A car wash partner has no space to reach them through — they are a supplier
   * of a service, not the owner of a bay — so the join `activeLinkedAccountForSpace`
   * uses does not exist for them. The `activated` requirement is identical and
   * is the point of both: a `pending` account cannot receive a transfer, so
   * treating it as usable produces a captured payment with no split, which is a
   * manual payout nobody scheduled, discovered when the partner's money does
   * not arrive.
   */
  async activeLinkedAccountForUser(userId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ razorpayAccountId: linkedAccounts.razorpayAccountId })
      .from(linkedAccounts)
      .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.kycStatus, 'activated')));

    return row?.razorpayAccountId;
  }

  async insert(tx: TxHandle, input: InsertPaymentInput) {
    const [row] = await tx
      .insert(payments)
      .values({
        bookingId: input.bookingId,
        userId: input.userId,
        razorpayOrderId: input.razorpayOrderId,
        expectedTotalPaise: input.expectedTotalPaise,
        status: 'created',
        // Defaulted so every existing caller stays a booking payment without
        // being edited. `payments_wash_job_coherence_check` refuses the two
        // fields disagreeing, so a wash payment cannot reach the table without
        // its job id.
        purpose: input.purpose ?? 'booking',
        washJobId: input.washJobId ?? null,
        routeTransferPaise: input.routeTransferPaise,
      })
      .returning();

    return row;
  }

  /** Who a wash's Route transfer paid, for the discharge at capture. */
  async washerForJob(tx: TxHandle, washJobId: string): Promise<string> {
    const [row] = await tx
      .select({ washerUserId: washJobs.washerUserId })
      .from(washJobs)
      .where(eq(washJobs.id, washJobId));
    // A captured wash payment for a job with no partner is a job nobody could
    // have sent a transfer to; `wash_jobs_assignee_presence_check` should have
    // made it unreachable, so it fails loudly rather than posting to nobody.
    if (row?.washerUserId == null) {
      throw new Error(`Wash job ${washJobId} has no partner to discharge a transfer against`);
    }
    return row.washerUserId;
  }

  async findByOrderId(razorpayOrderId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.razorpayOrderId, razorpayOrderId));
    return row;
  }

  /**
   * Row-locked read, joined to its booking.
   *
   * Capture arrives twice by design — once from the Checkout callback and once
   * from the webhook — and Razorpay redelivers on top of that. Without the lock
   * both readers see `pending_payment` and both credit the owner.
   */
  async findByOrderIdForUpdate(tx: TxHandle, razorpayOrderId: string) {
    const [row] = await tx
      .select({ payment: payments, booking: bookings })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(eq(payments.razorpayOrderId, razorpayOrderId))
      .for('update', { of: payments });

    return row;
  }

  /**
   * The order already open for this booking, if any.
   *
   * A booking may accumulate several payment rows — a failed attempt followed by
   * a retry is ordinary — so this deliberately matches only `created`. Reusing
   * it means a driver who reopens Checkout gets the same Razorpay order rather
   * than a new one each time, which keeps the webhook's join unambiguous and
   * stops a retry loop littering the gateway with orders nobody will pay.
   *
   * Scoped to `purpose = 'booking'`, and that filter is load-bearing.
   *
   * A car wash order hangs off the *same* booking (§13.4), so without it a
   * driver reopening Checkout for their parking would be handed the wash's open
   * order instead: the right gateway id for the wrong thing, at the wrong
   * amount, and a capture webhook that then marks the parking paid.
   */
  async findOpenForBooking(bookingId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          eq(payments.purpose, 'booking'),
          eq(payments.status, 'created'),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row;
  }

  /**
   * The captured payment for a wash, if the driver actually paid.
   *
   * Cancelling a wash always reverses the ledger, but only a *captured* payment
   * has money at the gateway to send back. Most cancellations happen before the
   * driver has paid at all — a partner is still being found — and in that case
   * the reversal is the whole story and no gateway call is owed.
   */
  async findLatestCapturedForWashJob(washJobId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.washJobId, washJobId),
          eq(payments.purpose, 'carwash'),
          eq(payments.status, 'captured'),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row;
  }

  /** The open order for a wash, so reopening Checkout does not mint a second. */
  async findOpenForWashJob(washJobId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.washJobId, washJobId),
          eq(payments.purpose, 'carwash'),
          eq(payments.status, 'created'),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row;
  }

  /**
   * The booking's captured parking payment, row-locked (`FOR UPDATE`) — the first statement of an
   * admin refund's transaction and of every cancellation's (driver or admin). It is the only
   * way a booking's payment is looked up for a refund, so the purpose filter below cannot be
   * forgotten by a second, unfiltered query.
   *
   * The lock is what makes "what is left to refund" safe to read: two admins refunding the same
   * booking queue here, and the second reads the refund total only after the first has committed,
   * so neither can spend a balance the other already spent (task 18a). It is taken before anything
   * else in the transaction so every writer to this payment acquires the same lock first.
   *
   * "Captured" means money reached us at some point: a partly or fully refunded payment still
   * matches, so a second partial refund finds it and a fully refunded one answers with a zero
   * balance rather than "never paid". Scoped to `purpose = 'booking'`: a car wash order hangs off
   * the same booking, and its money is not the parking's to refund. A payment the orphan job
   * refunded (`ORPHAN_CAPTURE_REFUND_REASON`) is excluded too: it is newer than the real capture
   * and already gone back in full, so picking it would refund nothing or the wrong gateway payment.
   */
  async lockCapturedForBooking(tx: TxHandle, bookingId: string) {
    const [row] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.bookingId, bookingId),
          eq(payments.purpose, 'booking'),
          inArray(payments.status, CAPTURED_PAYMENT_STATUSES),
          isNotNull(payments.razorpayPaymentId),
          isNotNull(payments.capturedPaise),
          notExists(
            tx
              .select({ id: refunds.id })
              .from(refunds)
              .where(
                and(
                  eq(refunds.paymentId, payments.id),
                  eq(refunds.reason, ORPHAN_CAPTURE_REFUND_REASON),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(payments.capturedAt))
      .limit(1)
      .for('update', { of: payments });
    return row;
  }

  /**
   * Every refund issued against a payment, whatever its gateway status: its ledger posting
   * committed when it was created. Read inside the caller's transaction, after
   * `lockCapturedForBooking`, so it includes everything committed before the lock was granted.
   * The reason travels with the amount because a full-reversal tier zeroes what is left
   * (`refundableOf`).
   */
  async refundsFor(tx: TxHandle, paymentId: string) {
    return tx
      .select({ amountPaise: refunds.amountPaise, reason: refunds.reason })
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
  }

  async markCaptured(
    tx: TxHandle,
    paymentId: string,
    input: {
      readonly razorpayPaymentId: string;
      readonly capturedPaise: number;
      readonly method: string | null;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx
      .update(payments)
      .set({
        status: 'captured' satisfies PaymentStatus,
        razorpayPaymentId: input.razorpayPaymentId,
        capturedPaise: input.capturedPaise,
        method: input.method,
        capturedAt: input.at,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  }

  async markFailed(
    tx: TxHandle,
    paymentId: string,
    input: { readonly razorpayPaymentId: string; readonly reason: string | null },
  ): Promise<void> {
    await tx
      .update(payments)
      .set({
        status: 'failed' satisfies PaymentStatus,
        razorpayPaymentId: input.razorpayPaymentId,
        failureReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  }

  async markRefunded(tx: TxHandle, paymentId: string, fully: boolean): Promise<void> {
    await tx
      .update(payments)
      .set({
        status: (fully ? 'refunded' : 'partially_refunded') satisfies PaymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  }

  async insertRefund(
    tx: TxHandle,
    input: { readonly paymentId: string; readonly amountPaise: number; readonly reason: string },
  ) {
    const [row] = await tx
      .insert(refunds)
      .values({
        paymentId: input.paymentId,
        amountPaise: input.amountPaise,
        reason: input.reason,
        status: 'pending',
      })
      .returning();

    return row;
  }

  async findRefundByGatewayId(razorpayRefundId: string) {
    const [row] = await this.db
      .select({ refund: refunds, payment: payments })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(eq(refunds.razorpayRefundId, razorpayRefundId));
    return row;
  }

  async markRefundProcessed(
    tx: TxHandle,
    refundId: string,
    input: { readonly razorpayRefundId: string; readonly at: Date },
  ): Promise<void> {
    await tx
      .update(refunds)
      .set({
        status: 'processed',
        razorpayRefundId: input.razorpayRefundId,
        processedAt: input.at,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }
}
