import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type WashPaymentOrder, washPaymentOrderSchema } from '@parkease/contracts/driver';
import type { CarwashServiceName } from '@parkease/contracts/enums';
import { computeWashFee } from '@parkease/contracts/money';
import type { Paise } from '@parkease/contracts/primitives';
import { toRate } from '@parkease/contracts/primitives';

import { env } from '../../../platform/config/env.schema.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OrderService } from '../../payment/order.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { CarwashService } from '../carwash.service.js';
import { SERVICE_LABELS } from '../catalog.service.js';
import { WasherNotOnboardedError, WashNotPayableError } from '../errors.js';

export interface CreateWashOrderInput {
  readonly washJobId: string;
  readonly driverId: string;
}

/**
 * The driver's pay action for a car wash. §13.4.
 *
 * **Why this is not part of accept.** §13.6 sketches the order being minted
 * inside `accept`, before the transaction. Three partners race for one job and
 * two of them lose the conditional UPDATE — so minting there means two Razorpay
 * orders created at the gateway that no webhook will ever join to a local row,
 * once per losing accept. That is precisely the condition
 * `payment.reconcile-orphan` exists to clean up, manufactured deliberately.
 *
 * So accept enforces the precondition (the partner must have an activated
 * Linked Account, or they cannot take the job at all) and mints nothing, and
 * this mints once a price is frozen on the row. The driver pays the partner who
 * actually won, at that partner's own price.
 *
 * Structurally a mirror of `payment/commands/create-order.command.ts`: ownership
 * 404, an existing open order returned rather than a second minted, the linked
 * account re-checked, Razorpay called outside any transaction, the `payments`
 * row written after.
 */
@Injectable()
export class CreateWashOrderCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
  ) {}

  async execute(input: CreateWashOrderInput): Promise<WashPaymentOrder> {
    // 404, not 403: confirming that someone else's wash exists is itself a
    // leak, and the ownership check is separate from the role guard (rule 7).
    const job = await this.carwash.findOwnedByDriver(input.washJobId, input.driverId);
    if (job === undefined) throw new NotFoundException();

    /**
     * No price means nobody has accepted, so there is nothing to charge for —
     * the amount comes from the winning partner's menu and until somebody wins
     * there is no menu to read. `washer_user_id` is checked alongside it
     * because `wash_jobs_assignee_presence_check` makes the two move together,
     * and reading one without the other would leave TypeScript unconvinced for
     * a reason the database has already settled.
     */
    if (job.pricePaise === null || job.washerUserId === null) {
      throw new WashNotPayableError();
    }
    if (job.status === 'cancelled') throw new WashNotPayableError();

    const fee = computeWashFee(job.pricePaise as Paise, toRate(Number(job.commissionRate)));

    // A driver who reopens Checkout gets the order they already have. Minting a
    // second one for the same wash would leave two orders the webhook could
    // arrive against, and only one of them joined to anything.
    const open = await this.payments.findOpenForWashJob(job.id);
    if (open !== undefined) {
      return this.view(
        open.razorpayOrderId,
        open.expectedTotalPaise,
        job.id,
        job.serviceName as CarwashServiceName,
      );
    }

    /**
     * Re-checked here even though accept already refused a partner without one.
     * KYC can lapse between accepting a job and the driver paying for it, and a
     * captured payment with no split is a manual payout nobody scheduled.
     */
    const linkedAccountId = await this.payments.activeLinkedAccountForUser(job.washerUserId);
    if (linkedAccountId === undefined) throw new WasherNotOnboardedError();

    // Outside the transaction, always (R-BE-04). The window between this call
    // and the insert below is the one case `payment.reconcile-orphan` exists
    // for: an order at Razorpay with no local row to join a webhook against.
    const order = await this.orders.createForWash(
      {
        id: job.id,
        bookingId: job.bookingId,
        driverUserId: job.driverUserId,
        driverTotalPaise: fee.driverTotalPaise,
        washerEarningsPaise: fee.washerEarningsPaise,
      },
      linkedAccountId,
    );

    await withTransaction(this.db, async (tx) => {
      await this.payments.insert(tx, {
        bookingId: job.bookingId,
        userId: job.driverUserId,
        razorpayOrderId: order.id,
        // The amount we told Razorpay to charge, computed from the frozen price
        // on the job rather than read back off the order. Comparing the capture
        // against a number the gateway supplied would compare the gateway with
        // itself (R-SEC-09).
        expectedTotalPaise: fee.driverTotalPaise,
        purpose: 'carwash',
        washJobId: job.id,
      });
    });

    return this.view(order.id, fee.driverTotalPaise, job.id, job.serviceName as CarwashServiceName);
  }

  private view(
    razorpayOrderId: string,
    amountPaise: number,
    washJobId: string,
    serviceName: CarwashServiceName,
  ): WashPaymentOrder {
    // Parsed, not cast. `washJobId` is a branded id and `amountPaise` is a
    // positive integer by contract; a cast would let a zero amount or a
    // non-uuid reach Checkout and fail there instead of here (R-VAL-01).
    return washPaymentOrderSchema.parse({
      razorpayOrderId,
      amountPaise,
      currency: 'INR',
      // Publishable by design; the secret never leaves the server (R-ENV-05).
      keyId: env.RAZORPAY_KEY_ID,
      serviceLabel: SERVICE_LABELS[serviceName],
      washJobId,
    });
  }
}
