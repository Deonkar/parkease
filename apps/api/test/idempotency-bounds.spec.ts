import { IDLE_IN_TRANSACTION_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } from '@parkease/db';
import { describe, expect, it } from 'vitest';

import { GATEWAY_TIMEOUT_MS } from '../src/platform/http/timeouts.js';
import {
  hashCanonicalBody,
  IDEMPOTENCY_IN_FLIGHT_STALE_MS,
  IdempotencyService,
  legacyHashCanonicalBody,
} from '../src/platform/idempotency/idempotency.service.js';

/**
 * S-64: the stale threshold is only safe if a live attempt cannot run that long. These are the
 * bounds its comment names; a change to any of them that breaks the ordering fails here.
 */
describe('idempotency stale threshold', () => {
  it('sits well above every bound on a live attempt', () => {
    // A handler is a few statements and at most a couple of gateway calls. Even a pessimistic
    // three of each stays under the threshold.
    expect(3 * STATEMENT_TIMEOUT_MS + 3 * GATEWAY_TIMEOUT_MS).toBeLessThan(
      IDEMPOTENCY_IN_FLIGHT_STALE_MS,
    );
    expect(IDLE_IN_TRANSACTION_TIMEOUT_MS).toBeLessThan(IDEMPOTENCY_IN_FLIGHT_STALE_MS);
  });
});

/** S-101: a leaked `idempotency_keys` table must not be a brute-force oracle for bank details. */
describe('request hash', () => {
  const body = { accountNumber: '123456789012', ifsc: 'HDFC0001234', name: 'Priya S.' };

  it('is not the plain SHA-256 of the canonical body', () => {
    expect(hashCanonicalBody(body)).not.toBe(legacyHashCanonicalBody(body));
    expect(hashCanonicalBody(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable and order-independent, like the hash it replaced', () => {
    expect(hashCanonicalBody({ b: 1, a: 2 })).toBe(hashCanonicalBody({ a: 2, b: 1 }));
    expect(hashCanonicalBody(body)).not.toBe(
      hashCanonicalBody({ ...body, accountNumber: '123456789013' }),
    );
  });
});

/**
 * S-80: the holder of a key can vanish between the conflicting insert and the read-back (a release
 * or the prune). The claim must not proceed with no row behind it, which would leave `store`
 * matching nothing; it claims the free key once more instead.
 */
describe('a claim whose holder vanished', () => {
  /** Answers each insert and select in turn from the scripts given. */
  const scripted = (inserts: unknown[][], selects: unknown[][]) =>
    ({
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => inserts.shift() ?? [] }),
        }),
      }),
      select: () => ({ from: () => ({ where: async () => selects.shift() ?? [] }) }),
    }) as never;

  const input = {
    key: 'k',
    userId: 'u',
    endpoint: 'POST /x',
    requestHash: 'h',
  };

  it('claims the freed key on the second insert', async () => {
    const db = scripted([[], [{ key: 'k' }]], [[]]);

    await expect(new IdempotencyService(db).claim(input)).resolves.toEqual({
      outcome: 'proceed',
    });
  });

  it('answers in flight, never proceed, when the key is churned twice in a row', async () => {
    const db = scripted([[], []], [[], []]);

    await expect(new IdempotencyService(db).claim(input)).resolves.toEqual({
      outcome: 'in_flight',
    });
  });
});
