import { Inject, Injectable } from '@nestjs/common';

import { TransferExceedsCaptureError } from './errors.js';
import {
  RAZORPAY,
  type RazorpayClient,
  type RazorpayOrder,
  type RouteTransfer,
} from './razorpay.client.js';

/** The booking columns an order needs. A stored row satisfies this structurally. */
export interface OrderableBooking {
  readonly id: string;
  readonly driverId: string;
  readonly totalPaise: number;
  readonly ownerEarningsPaise: number;
}

/**
 * A wash, priced. §13.4.
 *
 * Deliberately not `OrderableBooking` with different field names: the two
 * differ in what the numbers *mean*. A booking's total is quoted up front and
 * the owner's share is a cut of the base; a wash's total is not known until a
 * partner accepts from their own menu, and the partner's share is their price
 * less our commission. Sharing one interface would invite passing one where the
 * other belongs, which balances perfectly and pays the wrong person.
 */
export interface OrderableWash {
  readonly id: string;
  readonly bookingId: string;
  readonly driverUserId: string;
  readonly driverTotalPaise: number;
  readonly washerEarningsPaise: number;
}

@Injectable()
export class OrderService {
  constructor(@Inject(RAZORPAY) private readonly razorpay: RazorpayClient) {}

  /**
   * Creates the Razorpay order with the owner's share attached as a Route
   * transfer.
   *
   * Attaching it here rather than after capture is the whole point: the owner's
   * money settles when the payment captures, so there is no separate "pay the
   * owner for this booking" step and no window in which we hold their money
   * without a record of it (ADR-013).
   *
   * This method calls an external service, so it is never invoked inside a
   * transaction (R-BE-04). The `payments` row is written by the command around
   * it, before the Checkout handoff.
   */
  async createForBooking(
    booking: OrderableBooking,
    ownerLinkedAccountId: string,
  ): Promise<RazorpayOrder> {
    const transfers = this.transfersFor(booking, ownerLinkedAccountId);

    // Route refuses any payment whose transfers exceed the captured amount.
    // Ours is base − 15% against base + surge + GST, so it always clears — but
    // a future promo or fee change could break it silently, and Route's own
    // rejection is a gateway error nobody would trace back to our arithmetic.
    // Asserted before the call, so the test can prove the SDK was untouched.
    const transferredPaise = transfers.reduce((sum, transfer) => sum + transfer.amountPaise, 0);
    if (transferredPaise > booking.totalPaise) {
      throw new TransferExceedsCaptureError(transferredPaise, booking.totalPaise);
    }

    return this.razorpay.createOrder({
      amountPaise: booking.totalPaise,
      receipt: booking.id,
      notes: { bookingId: booking.id, driverId: booking.driverId },
      transfers,
    });
  }

  /**
   * The car wash order, with the partner's share attached as a Route transfer.
   *
   * A separate order from the parking booking's, and it has to be: the wash is
   * requested after the booking is paid, at a price that depends on which
   * partner won the offer race and what they charge (§13.4). There is no moment
   * at which it could have been a line item on the original order.
   *
   * Same posture as `createForBooking` otherwise — the transfer is attached
   * here rather than after capture, so the partner's money settles when the
   * payment captures and there is no window in which we hold it without a
   * record (ADR-013). This calls an external service, so it is never invoked
   * inside a transaction (R-BE-04).
   */
  async createForWash(wash: OrderableWash, washerLinkedAccountId: string): Promise<RazorpayOrder> {
    const transfers: readonly RouteTransfer[] =
      wash.washerEarningsPaise > 0
        ? [
            {
              account: washerLinkedAccountId,
              amountPaise: wash.washerEarningsPaise,
              // Task 16 reconciles Route settlement reports against our txn
              // ids. Carrying both ids means a wash transfer can be matched
              // back to the job and to the booking it hung off.
              notes: { washJobId: wash.id, bookingId: wash.bookingId },
            },
          ]
        : [];

    // Route refuses any payment whose transfers exceed the captured amount.
    // The partner's share is price − 20% against price + GST, so it always
    // clears — but a future rate change could break it silently, and Route's
    // own rejection is a gateway error nobody would trace back to our
    // arithmetic. Asserted before the call, so the test can prove the SDK was
    // untouched.
    const transferredPaise = transfers.reduce((sum, transfer) => sum + transfer.amountPaise, 0);
    if (transferredPaise > wash.driverTotalPaise) {
      throw new TransferExceedsCaptureError(transferredPaise, wash.driverTotalPaise);
    }

    return this.razorpay.createOrder({
      amountPaise: wash.driverTotalPaise,
      receipt: wash.id,
      notes: { washJobId: wash.id, bookingId: wash.bookingId, driverId: wash.driverUserId },
      transfers,
    });
  }

  /**
   * Zero transfers when the owner earns nothing. Razorpay rejects a zero-amount
   * transfer outright, and a fully discounted booking is not a reason to fail
   * the order — the owner's credit still exists in our ledger either way.
   */
  private transfersFor(
    booking: OrderableBooking,
    ownerLinkedAccountId: string,
  ): readonly RouteTransfer[] {
    if (booking.ownerEarningsPaise <= 0) return [];

    return [
      {
        account: ownerLinkedAccountId,
        amountPaise: booking.ownerEarningsPaise,
        // Task 16 reconciles Route settlement reports against our txn ids. A
        // transfer with no booking on it is a payment nobody can match back.
        notes: { bookingId: booking.id },
      },
    ];
  }
}
