import { Inject, Injectable } from '@nestjs/common';
import { refundSettledEntries } from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { PaymentService } from '../payment.service.js';

export interface ProcessRefundInput {
  readonly razorpayRefundId: string;
  readonly razorpayPaymentId: string;
  readonly amountPaise: number;
}

@Injectable()
export class ProcessRefundCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Razorpay confirms the money left (`refund.processed`), so the liability we
   * recorded when we decided to refund is settled against the receivable the
   * driver owed.
   *
   * Separate from the decision on purpose: `refunds_payable` is credited the
   * moment we commit to refunding, and discharged only when the gateway says
   * the money actually moved. Collapsing the two would claim cash had moved
   * before it had, and leave nothing on the books during the window where it
   * had not.
   */
  async execute(input: ProcessRefundInput): Promise<{ readonly settled: boolean }> {
    const found = await this.payments.findRefundByGatewayId(input.razorpayRefundId);

    // The worker writes `razorpay_refund_id` when it issues the refund, so an
    // event arriving before that write has nothing to join. Razorpay retries on
    // a non-2xx, which is the right answer: by the next delivery the row is
    // there. Returning `settled: false` lets the caller decide the status code.
    if (found === undefined) return { settled: false };

    const { refund } = found;

    // Redelivery. `refund.processed` is sent more than once in practice, and
    // settling twice would credit the driver's receivable twice over.
    if (refund.status === 'processed') return { settled: true };

    await withTransaction(this.db, async (tx) => {
      await this.payments.markRefundProcessed(tx, refund.id, {
        razorpayRefundId: input.razorpayRefundId,
        at: new Date(),
      });

      await this.ledger.post(tx, {
        bookingId: found.payment.bookingId,
        paymentId: found.payment.id,
        counterpartyUserId: found.payment.userId,
        // The gateway's amount, not ours. If Razorpay refunded a different
        // amount than we asked for, the ledger must record what happened rather
        // than what we intended — the two are reconciled in task 16.
        entries: refundSettledEntries(input.amountPaise, 'refund processed'),
      });
    });

    return { settled: true };
  }
}
