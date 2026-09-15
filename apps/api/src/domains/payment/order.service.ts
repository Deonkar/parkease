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
