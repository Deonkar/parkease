import { Inject, Injectable } from '@nestjs/common';
import type { PaymentStatus } from '@parkease/contracts/enums';
import { bookings, linkedAccounts, payments, refunds, spaces } from '@parkease/db/schema';
import { and, desc, eq } from 'drizzle-orm';

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
}

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
      })
      .returning();

    return row;
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
   */
  /**
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
   * The captured payment for a booking, if the driver ever actually paid.
   *
   * A booking may carry several rows — failed attempts then a success — and only
   * a captured one has money at the gateway to send back. Returning the newest
   * matters when a driver paid, was refunded, and paid again.
   */
  async findLatestCapturedForBooking(bookingId: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), eq(payments.status, 'captured')))
      .orderBy(desc(payments.capturedAt))
      .limit(1);
    return row;
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
