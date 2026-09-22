import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeWashFee, reverseEntries, washEntries } from '@parkease/contracts/money';
import type { Paise } from '@parkease/contracts/primitives';
import { toRate } from '@parkease/contracts/primitives';
import { uuidv7 } from '@parkease/db';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { CarwashService, type WashJobRow } from '../carwash.service.js';
import { assertTransition, parseCarwashJobStatus } from '../lifecycle.js';

export interface CancelWashInput {
  readonly jobId: string;
  readonly driverId: string;
  readonly reason?: string;
}

@Injectable()
export class CancelWashCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: CancelWashInput): Promise<WashJobRow> {
    const job = await this.carwash.findOwnedByDriver(input.jobId, input.driverId);
    if (job === undefined) throw new NotFoundException();

    /**
     * §13.9. Throws from `washing`, because the machine has no cancel edge
     * there: the partner has travelled with their equipment and started, and
     * cancelling would mean they absorb the trip and the supplies.
     *
     * Asserted before the transaction so the refusal costs nothing.
     */
    assertTransition(parseCarwashJobStatus(job.status), 'cancel');

    return withTransaction(this.db, async (tx) => {
      const updated = await this.carwash.applyEvent(tx, job, 'cancel', {
        cancelledAt: new Date(),
        ...(input.reason === undefined ? {} : { cancellationReason: input.reason }),
      });

      /**
       * Only reverse if something was posted.
       *
       * A job cancelled from `requested` or `offered` has no `txn_id` because
       * nobody ever accepted it, so nobody is owed anything and no partner was
       * dispatched. The absence of entries is the correct posting — writing a
       * balanced zero would be a lie about work that never happened, and
       * `assertEntriesBalance` refuses an empty posting anyway.
       */
      if (job.txnId !== null && job.pricePaise !== null && job.washerUserId !== null) {
        const fee = computeWashFee(job.pricePaise as Paise, toRate(Number(job.commissionRate)));

        await this.ledger.post(tx, {
          txnId: uuidv7(),
          bookingId: job.bookingId,
          entries: reverseEntries(
            washEntries(fee, job.washerUserId, 'car wash service'),
            'car wash cancellation reversal',
          ),
        });

        /**
         * A gateway refund is owed only if money actually moved.
         *
         * Most wash cancellations happen before the driver has paid — a partner
         * is still being found, or has only just accepted — and then the
         * reversal above is the whole story: nothing was collected, so there is
         * nothing to send back.
         *
         * When there *is* a capture, the `refunds` row commits here and the
         * Razorpay call is an outbox message the worker picks up afterwards.
         * **Ledger first, money second**, the same order `RefundService` uses:
         * a crash between the two leaves a refund we owe and can retry, never
         * money gone with no record of it (R-ASYNC-01, R-BE-04).
         */
        const captured = await this.payments.findLatestCapturedForWashJob(job.id);

        if (captured?.razorpayPaymentId != null) {
          const refund = await this.payments.insertRefund(tx, {
            paymentId: captured.id,
            amountPaise: fee.driverTotalPaise,
            reason: 'carwash_cancelled',
          });

          // `.returning()` gave nothing back, which means the insert did not
          // happen. Failing loudly beats enqueueing a gateway call against a
          // row that does not exist (R-FAIL-01).
          if (refund === undefined) {
            throw new Error(`Refund row for wash payment ${captured.id} was not created`);
          }

          await this.payments.markRefunded(tx, captured.id, true);

          await this.outbox.enqueue(tx, {
            type: 'payment.issue-refund',
            payload: {
              refundId: refund.id,
              paymentId: captured.id,
              bookingId: job.bookingId,
              razorpayPaymentId: captured.razorpayPaymentId,
              amountPaise: fee.driverTotalPaise,
            },
          });
        }
      }

      await this.outbox.enqueue(
        tx,
        {
          type: 'notification.dispatch',
          payload: {
            userId: job.driverUserId,
            template: 'washer.cancelled',
            data: { jobId: job.id },
          },
        },
        // The partner, if there was one. A partner who was on their way and
        // learns nothing is a partner who arrives to a cancelled job.
        ...(job.washerUserId === null
          ? []
          : [
              {
                type: 'notification.dispatch' as const,
                payload: {
                  userId: job.washerUserId,
                  template: 'washer.job_cancelled',
                  data: { jobId: job.id },
                },
              },
            ]),
      );

      return updated;
    });
  }
}
