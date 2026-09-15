import { Inject, Injectable } from '@nestjs/common';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { PaymentService } from '../payment.service.js';

export interface FailPaymentInput {
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly reason: string | null;
}

@Injectable()
export class FailPaymentCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Records that an attempt failed. It deliberately does **not** cancel the
   * booking.
   *
   * The driver has a ten-minute hold and may well pay on the second try — a
   * wrong OTP, a bank timeout, a UPI app that never opened. Cancelling here
   * would release a slot they are still standing in front of trying to pay for.
   * The expiry job owns letting go of the slot, on the clock, and it is the only
   * thing that should.
   */
  async execute(input: FailPaymentInput): Promise<{ readonly recorded: boolean }> {
    return withTransaction(this.db, async (tx) => {
      const locked = await this.payments.findByOrderIdForUpdate(tx, input.razorpayOrderId);
      if (locked === undefined) return { recorded: false };

      const { payment } = locked;

      // A failure arriving after a success is a redelivery of an older event,
      // not news. Overwriting a captured payment with `failed` would strand a
      // confirmed booking against a payment row claiming nothing was paid.
      if (payment.status === 'captured') return { recorded: false };

      await this.payments.markFailed(tx, payment.id, {
        razorpayPaymentId: input.razorpayPaymentId,
        reason: input.reason,
      });

      await this.outbox.enqueue(tx, {
        type: 'payment.failed',
        payload: {
          bookingId: payment.bookingId,
          driverId: payment.userId,
          reason: input.reason,
        },
      });

      return { recorded: true };
    });
  }
}
