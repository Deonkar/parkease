import { Injectable } from '@nestjs/common';
import Razorpay from 'razorpay';

import { env } from '../../platform/config/env.schema.js';

import {
  type CreateOrderInput,
  type CreateRefundInput,
  type RazorpayClient,
  type RazorpayOrder,
  type RazorpayRefund,
  razorpayRefundListSchema,
  REFUND_REFERENCE_NOTE,
  toOrder,
  toRefund,
} from './razorpay.client.js';

/**
 * The only file in the codebase that imports the Razorpay SDK.
 *
 * Everything it returns goes through `toOrder` / `toRefund`, which parse rather
 * than cast. Everything it is given is converted at this boundary too: the SDK
 * takes a JS `number` of paise, and this is where our integers become that
 * number — once, in one place, instead of at every call site with an
 * eslint-disable above it.
 */
@Injectable()
export class RazorpaySdkClient implements RazorpayClient {
  private readonly client = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });

  async createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
    const order = await this.client.orders.create({
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt,
      notes: { ...input.notes },
      transfers: input.transfers.map((transfer) => ({
        account: transfer.account,
        amount: transfer.amountPaise,
        currency: 'INR',
        // The owner's share settles when the payment captures. Holding it would
        // mean we decide later when they get paid, which is the manual payout
        // step Route exists to remove (ADR-013).
        on_hold: false,
        notes: { ...transfer.notes },
      })),
    });

    return toOrder(order);
  }

  async fetchOrder(orderId: string): Promise<RazorpayOrder> {
    return toOrder(await this.client.orders.fetch(orderId));
  }

  async createRefund(input: CreateRefundInput): Promise<RazorpayRefund> {
    const refund = await this.client.payments.refund(input.paymentId, {
      amount: input.amountPaise,
      notes: { ...input.notes, [REFUND_REFERENCE_NOTE]: input.reference },
    });

    return toRefund(refund);
  }

  async findRefundByReference(
    paymentId: string,
    reference: string,
  ): Promise<RazorpayRefund | null> {
    const page = razorpayRefundListSchema.parse(
      await this.client.payments.fetchMultipleRefund(paymentId),
    );

    const existing = page.items.find(
      (refund) => refund.notes?.[REFUND_REFERENCE_NOTE] === reference,
    );

    return existing === undefined ? null : toRefund(existing);
  }
}
