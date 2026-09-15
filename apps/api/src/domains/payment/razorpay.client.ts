import { z } from 'zod';

/**
 * The gateway, as the rest of the codebase is allowed to see it.
 *
 * Four methods, our own vocabulary, paise everywhere. The SDK's types are not
 * re-exported and its objects never leave this file: a third-party response is
 * outside data, so it is parsed, not asserted (R-VAL-01). That the SDK ships
 * `.d.ts` files changes nothing — those describe what Razorpay intends to send,
 * not what arrived.
 *
 * It is an interface with an injection token rather than a class so that every
 * test drives a double and can assert the call was *not* made — which is how the
 * Route constraint and the onboarding check are tested.
 */
export const RAZORPAY = Symbol('RAZORPAY');

export interface RouteTransfer {
  /** The owner's Linked Account, `acc_…`. */
  readonly account: string;
  readonly amountPaise: number;
  readonly notes: Readonly<Record<string, string>>;
}

export interface CreateOrderInput {
  readonly amountPaise: number;
  readonly receipt: string;
  readonly notes: Readonly<Record<string, string>>;
  readonly transfers: readonly RouteTransfer[];
}

/**
 * The note key every refund we create carries, holding our own `refunds.id`.
 *
 * The SDK's `payments.refund(paymentId, params)` takes no headers, so
 * Razorpay's `X-Payment-Idempotency` is not reachable through it. The outbox
 * delivers at least once, so the refund job has to answer "did I already do
 * this?" itself — and the only durable place to ask is Razorpay, by looking for
 * a refund already carrying this reference. Hence the note, and
 * `findRefundByReference` beside it.
 */
export const REFUND_REFERENCE_NOTE = 'parkeaseRefundId';

export interface CreateRefundInput {
  readonly paymentId: string;
  readonly amountPaise: number;
  /** Our `refunds.id`. Written to `notes[REFUND_REFERENCE_NOTE]`. */
  readonly reference: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface RazorpayOrder {
  readonly id: string;
  readonly amountPaise: number;
  /** What has actually been captured against this order. 0 until capture. */
  readonly amountPaidPaise: number;
  readonly currency: string;
  readonly status: string;
}

export interface RazorpayRefund {
  readonly id: string;
  readonly paymentId: string;
  readonly amountPaise: number;
  readonly status: string;
}

export interface RazorpayClient {
  createOrder(input: CreateOrderInput): Promise<RazorpayOrder>;
  fetchOrder(orderId: string): Promise<RazorpayOrder>;
  createRefund(input: CreateRefundInput): Promise<RazorpayRefund>;
  /**
   * The refund we already created for this reference, or null. Asked before
   * every create, so a job that crashed after the gateway call and before the
   * local write does not refund the driver twice.
   */
  findRefundByReference(paymentId: string, reference: string): Promise<RazorpayRefund | null>;
}

/**
 * Razorpay sends money as a JSON number of paise. Anything fractional is a rupee
 * amount wearing the wrong name, and a rupee amount that survives parsing is a
 * hundredfold error in the ledger (R-MONEY-01).
 */
const gatewayPaise = z.number().int().nonnegative();

export const razorpayOrderResponseSchema = z.object({
  id: z.string().min(1),
  amount: gatewayPaise,
  amount_paid: gatewayPaise,
  currency: z.string().min(1),
  status: z.string().min(1),
});

export const razorpayRefundResponseSchema = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: gatewayPaise,
  status: z.string().min(1),
  notes: z.record(z.unknown()).nullish(),
});

export const razorpayRefundListSchema = z.object({
  items: z.array(razorpayRefundResponseSchema),
});

export const toOrder = (raw: unknown): RazorpayOrder => {
  const parsed = razorpayOrderResponseSchema.parse(raw);
  return {
    id: parsed.id,
    amountPaise: parsed.amount,
    amountPaidPaise: parsed.amount_paid,
    currency: parsed.currency,
    status: parsed.status,
  };
};

export const toRefund = (raw: unknown): RazorpayRefund => {
  const parsed = razorpayRefundResponseSchema.parse(raw);
  return {
    id: parsed.id,
    paymentId: parsed.payment_id,
    amountPaise: parsed.amount,
    status: parsed.status,
  };
};
