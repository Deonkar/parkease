import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeWashFee, reverseEntries, washEntries } from '@parkease/contracts/money';
import type { Paise } from '@parkease/contracts/primitives';
import { toRate } from '@parkease/contracts/primitives';
import { uuidv7 } from '@parkease/db';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
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
         * The refund is the worker's, off the outbox, because issuing it is an
         * external call and this is a transaction (rule 4). The handler is a
         * no-op when no payment was ever captured, which is the common case:
         * most cancellations happen before the driver has paid at all.
         */
        await this.outbox.enqueue(tx, {
          type: 'payment.issue-refund',
          payload: { washJobId: job.id, amountPaise: fee.driverTotalPaise },
        });
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
