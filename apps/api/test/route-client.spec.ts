import { afterEach, describe, expect, it, vi } from 'vitest';

import { RazorpayApiError } from '../src/domains/payout/razorpay-rest.js';
import { RouteHttpClient } from '../src/domains/payout/route.client.js';

/**
 * S-112: a create whose response was lost leaves nothing saved, so the retry creates again and
 * Razorpay refuses with "Merchant email already exists for account - <id>". The client carries on
 * with that account instead of telling the user to check their PAN forever.
 */
const INPUT = {
  email: 'priya@example.in',
  phone: '9876543210',
  legalName: 'Priya Sharma',
  category: 'others',
  subcategory: 'others',
  street: '12, 5th Cross',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560038',
  referenceId: '0192f1c0-0000-7000-8000-000000000001',
} as const;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RouteHttpClient.upsertAccount', () => {
  it('recovers the account a lost create made, then updates it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        answer(400, {
          error: {
            code: 'BAD_REQUEST_ERROR',
            description: 'Merchant email already exists for account - BbHKlnuyZkf0xa',
          },
        }),
      )
      .mockResolvedValueOnce(answer(200, { id: 'acc_BbHKlnuyZkf0xa' }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RouteHttpClient().upsertAccount(null, INPUT)).resolves.toBe(
      'acc_BbHKlnuyZkf0xa',
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'https://api.razorpay.com/v2/accounts/acc_BbHKlnuyZkf0xa',
    );
    expect((fetch.mock.calls[1]?.[1] as RequestInit).method).toBe('PATCH');
  });

  it('still refuses a create Razorpay rejected for any other reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          answer(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Invalid PAN' } }),
        ),
    );

    const error = await new RouteHttpClient().upsertAccount(null, INPUT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RazorpayApiError);
    expect((error as RazorpayApiError).existingAccountId).toBeNull();
    // Nothing from the refusal's body reaches the message, which is logged.
    expect((error as RazorpayApiError).message).not.toContain('Invalid PAN');
  });
});
