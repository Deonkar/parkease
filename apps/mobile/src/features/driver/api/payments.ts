import {
  type PaymentOrder,
  paymentOrderSchema,
  type PaymentResult,
  paymentResultSchema,
  type VerifyPayment,
} from '@parkease/contracts/driver';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

/** Parsed, never asserted — a network payload is outside data (R-VAL-01). */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

export async function createPaymentOrder(bookingId: string, intent: Intent): Promise<PaymentOrder> {
  const response = await api.post<unknown>(
    '/driver/payments/orders',
    { bookingId },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );

  return envelope(paymentOrderSchema).parse(response.data).data;
}

/**
 * The Checkout success callback.
 *
 * A convenience, not the source of truth: `payment.captured` from the webhook is
 * authoritative, and both funnel into the same idempotent command server-side.
 * This exists so the driver sees a confirmed screen immediately rather than
 * waiting on a webhook they cannot observe.
 *
 * No amount is sent. There is nothing in this body the server trusts about what
 * was paid — it re-fetches the order from Razorpay (R-SEC-09).
 */
export async function verifyPayment(body: VerifyPayment, intent: Intent): Promise<PaymentResult> {
  const response = await api.post<unknown>('/driver/payments/verify', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });

  return envelope(paymentResultSchema).parse(response.data).data;
}
