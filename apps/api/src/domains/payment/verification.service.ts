import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { env } from '../../platform/config/env.schema.js';

import { InvalidWebhookSignatureError } from './errors.js';

@Injectable()
export class VerificationService {
  /**
   * Verifies Razorpay's webhook signature over the exact bytes that arrived.
   *
   * `rawBody` is a Buffer from the content-type parser, never
   * `JSON.stringify(request.body)`. That substitution is the v1 bug, and
   * `webhook-signature.spec.ts` asserts it as a regression: the same signature
   * against a re-serialised body with different key order must be rejected.
   */
  verifyWebhookSignature(rawBody: Buffer | undefined, headerSignature: unknown): void {
    if (rawBody === undefined) throw new InvalidWebhookSignatureError();
    if (typeof headerSignature !== 'string' || headerSignature.length === 0) {
      throw new InvalidWebhookSignatureError();
    }

    const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest();

    // `Buffer.from(hex)` truncates silently on invalid hex rather than throwing,
    // so a malformed header arrives here as a short buffer. Length is checked
    // first because `timingSafeEqual` *throws* on unequal lengths instead of
    // returning false — an exception that would escape as a 500 rather than the
    // 401 a bad signature deserves.
    const provided = Buffer.from(headerSignature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new InvalidWebhookSignatureError();
    }
  }

  /**
   * Verifies the signature Checkout hands the client on success, which is the
   * HMAC of `order_id|payment_id` under the key secret — a different secret and
   * a different message from the webhook's.
   *
   * It proves the callback came from Checkout rather than from a replayed URL.
   * It does **not** prove an amount: nothing the client posts is trusted for
   * that, and `confirm-payment` re-fetches the order regardless (R-SEC-09).
   */
  verifyCheckoutSignature(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
  ): void {
    const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest();

    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new InvalidWebhookSignatureError();
    }
  }
}
