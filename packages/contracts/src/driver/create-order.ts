import { z } from 'zod';

export const createOrderSchema = z.object({
  bookingId: z.string().uuid(),
});

export type CreateOrder = z.infer<typeof createOrderSchema>;

/**
 * What the app needs to open Razorpay Checkout, and nothing more.
 *
 * Deliberately **without** the Route transfer list. Task 9's worked example puts
 * `transfers: [{ account: 'acc_…', amountPaise: 5100 }]` in this response, which
 * hands a driver the owner's Linked Account id and the owner's exact earnings —
 * and from those two numbers, our commission. A driver has no use for any of it,
 * and the owner never agreed to publish it. The split is attached to the order
 * server-side, which is the only place it belongs (R-SEC-05).
 *
 * `amountPaise` is the amount the server fixed at order creation. The client
 * hands it straight to Checkout and never computes one (R-FE-06).
 */
export const paymentOrderSchema = z.object({
  razorpayOrderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  /** Publishable by design. The secret never leaves the server (R-ENV-05). */
  keyId: z.string().min(1),
  /** Shown as the Checkout description, so the driver recognises what they are paying for. */
  spaceTitle: z.string().min(1),
  bookingId: z.string().uuid(),
});

export type PaymentOrder = z.infer<typeof paymentOrderSchema>;
