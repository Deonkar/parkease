import { z } from 'zod';

import { env } from '../../config/env.js';

/**
 * The worker's RazorpayX client: create a payout, read one back. Mirrors the
 * API's `razorpayx.client.ts` rather than importing it — separate deployables
 * (see `jobs/payment/razorpay.ts`). Plain `fetch`: the Razorpay SDK has no
 * RazorpayX payouts. Every response is parsed (R-VAL-01).
 */
export class RazorpayXError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'RazorpayXError';
  }

  /**
   * RazorpayX refused what we sent: 400 (bad request) or 422 (validation).
   * Not 401/403 (our credentials), 409 (an idempotency conflict — the first
   * attempt may have landed) or 429 (rate limit): those are ours to retry, and
   * failing a payout on them would reverse money that may already be moving.
   */
  get rejected(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

export interface SentPayout {
  readonly id: string;
  readonly status: string;
}

export interface PayoutGateway {
  create(input: {
    payoutId: string;
    accountNumber: string;
    fundAccountId: string;
    amountPaise: number;
    period: string;
  }): Promise<SentPayout>;
  fetch(razorpayPayoutId: string): Promise<SentPayout>;
}

const payoutResponse = z.object({ id: z.string().min(1), status: z.string().min(1) });

const BASE_URL = 'https://api.razorpay.com/v1';

async function call(path: string, init: RequestInit): Promise<SentPayout> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RazorpayXError(null, `RazorpayX ${path} unreachable: ${String(error)}`);
  }
  if (!response.ok) {
    throw new RazorpayXError(
      response.status,
      `RazorpayX ${path} answered ${String(response.status)}`,
    );
  }
  const parsed = payoutResponse.parse(await response.json());
  return { id: parsed.id, status: parsed.status };
}

export const razorpayxPayouts: PayoutGateway = {
  create: ({ payoutId, accountNumber, fundAccountId, amountPaise, period }) =>
    call('/payouts', {
      method: 'POST',
      // RazorpayX's own idempotency, keyed by our payout id: a job that crashed
      // after the call and before recording it re-sends and gets the same
      // payout back, not a second one.
      headers: { 'X-Payout-Idempotency': payoutId },
      body: JSON.stringify({
        account_number: accountNumber,
        fund_account_id: fundAccountId,
        amount: amountPaise,
        currency: 'INR',
        mode: 'NEFT',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: payoutId,
        // Alphanumerics and spaces only, 30 characters at most.
        narration: `ParkEase payout ${period.replace('-', ' ')}`,
      }),
    }),
  fetch: (razorpayPayoutId) =>
    call(`/payouts/${encodeURIComponent(razorpayPayoutId)}`, { method: 'GET' }),
};
