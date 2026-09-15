import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentOrder } from '@parkease/contracts/driver';

import { env } from '../../../platform/config/env.schema.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { BookingService } from '../../booking/booking.service.js';
import { BookingNotPayableError, OwnerNotOnboardedError } from '../errors.js';
import { OrderService } from '../order.service.js';
import { PaymentService } from '../payment.service.js';

export interface CreateOrderInput {
  readonly bookingId: string;
  readonly driverId: string;
}

@Injectable()
export class CreateOrderCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
  ) {}

  async execute(input: CreateOrderInput): Promise<PaymentOrder> {
    const found = await this.bookings.findWithSpace(input.bookingId);

    // 404, not 403: confirming that someone else's booking exists is itself a
    // leak, and the ownership check is separate from the role guard (rule 7).
    if (found === undefined || found.booking.driverId !== input.driverId) {
      throw new NotFoundException('That booking does not exist.');
    }

    const { booking, space } = found;
    if (booking.status !== 'pending_payment') throw new BookingNotPayableError();

    // A driver who reopens Checkout gets the order they already have. Minting a
    // second one for the same booking would leave two orders the webhook could
    // arrive against, and only one of them joined to anything.
    const open = await this.payments.findOpenForBooking(booking.id);
    if (open !== undefined) {
      return this.view(open.razorpayOrderId, open.expectedTotalPaise, booking.id, space.title);
    }

    // An owner whose KYC has not activated cannot be settled at capture, and a
    // captured payment with no split becomes a manual payout in task 16. Better
    // to refuse now than to take money we cannot route.
    const linkedAccountId = await this.payments.activeLinkedAccountForSpace(booking.spaceId);
    if (linkedAccountId === undefined) throw new OwnerNotOnboardedError();

    // Outside the transaction, always (R-BE-04). The window between this call
    // and the insert below is the one case `payment.reconcile-orphan` exists
    // for: an order at Razorpay with no local row to join a webhook against.
    const order = await this.orders.createForBooking(booking, linkedAccountId);

    await withTransaction(this.db, async (tx) => {
      await this.payments.insert(tx, {
        bookingId: booking.id,
        userId: booking.driverId,
        razorpayOrderId: order.id,
        // The amount we told Razorpay to charge, from the booking row rather
        // than from the order we just got back. Comparing the capture against a
        // number the gateway supplied would compare the gateway with itself.
        expectedTotalPaise: booking.totalPaise,
      });
    });

    return this.view(order.id, booking.totalPaise, booking.id, space.title);
  }

  private view(
    razorpayOrderId: string,
    amountPaise: number,
    bookingId: string,
    spaceTitle: string,
  ): PaymentOrder {
    return {
      razorpayOrderId,
      amountPaise,
      currency: 'INR',
      // Publishable by design; the secret never leaves the server (R-ENV-05).
      keyId: env.RAZORPAY_KEY_ID,
      spaceTitle,
      bookingId,
    };
  }
}
