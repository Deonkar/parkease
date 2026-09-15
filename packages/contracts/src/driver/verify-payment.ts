import { z } from 'zod';

import { paymentStatusSchema } from '../enums/index.js';

/**
 * The Checkout success callback.
 *
 * Note what is *not* here: an amount. v1 trusted the amount the client posted
 * back from Checkout, which is a number the client controls. The server
 * re-fetches the order from Razorpay and compares against
 * `payments.expected_total_paise` instead, so nothing in this body can influence
 * what we believe was paid (R-SEC-09).
 *
 * The signature is Razorpay's `razorpay_signature` over
 * `razorpay_order_id|razorpay_payment_id`, HMAC-SHA256 with the key secret. It
 * proves the callback came from Checkout rather than from a replayed URL.
 */
export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().min(1).max(256),
});

export type VerifyPayment = z.infer<typeof verifyPaymentSchema>;

/**
 * This endpoint exists so the app can show a confirmed screen immediately. It is
 * a convenience, never the source of truth: `payment.captured` from the webhook
 * is authoritative. Both funnel into the same idempotent command, so whichever
 * arrives first wins and the second is a replay.
 */
export const paymentResultSchema = z.object({
  bookingId: z.string().uuid(),
  status: paymentStatusSchema,
  /** The booking's status after confirmation, so the app can route without a refetch. */
  bookingStatus: z.string().min(1),
});

export type PaymentResult = z.infer<typeof paymentResultSchema>;
