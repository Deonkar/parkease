import Razorpay from 'razorpay';
import { z } from 'zod';

import { env } from '../../config/env.js';

/**
 * The worker's Razorpay client.
 *
 * It mirrors `apps/api/src/domains/payment/razorpay.sdk.ts` rather than
 * importing it, for the same reason `jobs/booking/ledger.ts` mirrors
 * `LedgerService`: the worker is a separate deployable with no Nest container,
 * so it cannot reach into the API. What is worth sharing — the money rules —
 * already lives in `packages/contracts`.
 *
 * Every response is parsed, never cast. A gateway reply is outside data whatever
 * its `.d.ts` claims (R-VAL-01).
 */
const gatewayPaise = z.number().int().nonnegative();

const refundSchema = z.object({
  id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: gatewayPaise,
  status: z.string().min(1),
  notes: z.record(z.unknown()).nullish(),
});

const refundListSchema = z.object({ items: z.array(refundSchema) });

export interface WorkerRefund {
  readonly id: string;
  readonly amountPaise: number;
  readonly status: string;
}

/**
 * The note key carrying our own `refunds.id`.
 *
 * The SDK's `payments.refund(paymentId, params)` takes no headers, so Razorpay's
 * `X-Payment-Idempotency` is unreachable through it. Delivery is at-least-once,
 * so the job has to answer "did I already do this?" itself — and the only
 * durable place to ask is Razorpay.
 */
export const REFUND_REFERENCE_NOTE = 'parkeaseRefundId';

/**
 * Constructed on first use, not at import.
 *
 * `issue-refund.job.ts` imports this module to get the default gateway, and its
 * tests hand it a double instead. Building the SDK at module scope would make
 * merely importing the job reach for credentials it is never going to use.
 */
let client: Razorpay | undefined;

const sdk = (): Razorpay => {
  client ??= new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return client;
};

export interface RefundGateway {
  findByReference(paymentId: string, reference: string): Promise<WorkerRefund | null>;
  create(input: {
    paymentId: string;
    amountPaise: number;
    reference: string;
    bookingId: string;
  }): Promise<WorkerRefund>;
}

export const razorpayRefunds: RefundGateway = {
  async findByReference(paymentId, reference) {
    const page = refundListSchema.parse(await sdk().payments.fetchMultipleRefund(paymentId));
    const existing = page.items.find(
      (refund) => refund.notes?.[REFUND_REFERENCE_NOTE] === reference,
    );

    return existing === undefined
      ? null
      : { id: existing.id, amountPaise: existing.amount, status: existing.status };
  },

  async create({ paymentId, amountPaise, reference, bookingId }) {
    const refund = refundSchema.parse(
      await sdk().payments.refund(paymentId, {
        amount: amountPaise,
        notes: { [REFUND_REFERENCE_NOTE]: reference, bookingId },
      }),
    );

    return { id: refund.id, amountPaise: refund.amount, status: refund.status };
  },
};
