import type { z } from 'zod';

import { env } from '../../platform/config/env.schema.js';

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
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RazorpayApiError(null, `Razorpay ${method} ${path} unreachable: ${String(error)}`);
  }
  if (!response.ok) {
    throw new RazorpayApiError(
      response.status,
      `Razorpay ${method} ${path} answered ${String(response.status)}`,
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
