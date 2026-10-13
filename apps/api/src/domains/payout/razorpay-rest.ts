import type { z } from 'zod';

import { env } from '../../platform/config/env.schema.js';
import { GATEWAY_TIMEOUT_MS } from '../../platform/http/timeouts.js';

/**
 * `status` is what Razorpay answered, or null when it never answered. Only a 400/422 is
 * Razorpay refusing what we sent; a 401/403 is our credentials, a 409 an idempotency conflict,
 * a 429 our rate, and an unreadable 200 Razorpay misbehaving — all "try again", never
 * "check your details".
 */
export class RazorpayApiError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
    /**
     * The Linked Account a refused create says already exists (S-112): Razorpay answers a second
     * create for the same merchant with "Merchant email already exists for account - <id>". Only
     * that id is kept from the body, never the rest of it, which can echo what we sent.
     */
    readonly existingAccountId: string | null = null,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }

  get rejected(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

const HOST = 'https://api.razorpay.com';

/**
 * One Razorpay REST call (RazorpayX `/v1`, Route onboarding `/v2`): basic auth, a 10s timeout,
 * and the response parsed, never cast (R-VAL-01). The body of a refusal can echo what we sent
 * (an account number), so only the status crosses into the error.
 */
export async function razorpayRequest<T>(
  method: 'POST' | 'PATCH' | 'GET',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let response: Response;
  try {
    response = await fetch(`${HOST}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new RazorpayApiError(null, `Razorpay ${method} ${path} unreachable: ${String(error)}`);
  }
  if (!response.ok) {
    throw new RazorpayApiError(
      response.status,
      `Razorpay ${method} ${path} answered ${String(response.status)}`,
      await existingAccountIn(response),
    );
  }
  try {
    return schema.parse(await response.json());
  } catch (error) {
    throw new RazorpayApiError(
      response.status,
      `Razorpay ${method} ${path} answered unreadably: ${String(error)}`,
    );
  }
}

const EXISTING_ACCOUNT = /already exists for account\s*-\s*(?:acc_)?([A-Za-z0-9]{14})\b/;

/** The account id in a duplicate-create refusal, and nothing else from the body. */
async function existingAccountIn(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { description?: unknown } };
    const description = body.error?.description;
    if (typeof description !== 'string') return null;
    const match = EXISTING_ACCOUNT.exec(description);
    return match?.[1] === undefined ? null : `acc_${match[1]}`;
  } catch {
    return null;
  }
}
