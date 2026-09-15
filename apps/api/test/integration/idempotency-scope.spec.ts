import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pgConstraintName } from '../../src/platform/db/errors.js';
import { IdempotencyService } from '../../src/platform/idempotency/idempotency.service.js';

import { type Harness, startHarness, stopHarness } from './harness.js';

/**
 * Who is allowed to claim an idempotency key without being a user.
 *
 * Task 9 needs this because ADR-011 deduplicates Razorpay webhooks on the event
 * id in this same table, and Razorpay is not a user. Widening `user_id` to
 * nullable then raises the question the constraint answers: which routes may
 * legitimately have no owner, and which must never.
 *
 * It also pins a defect that shipped in task 4. `IdempotencyInterceptor` wrote
 * the literal string 'anonymous' when `request.user` was absent, and 'anonymous'
 * is not a uuid — so every POST /auth/session and POST /auth/refresh failed the
 * insert with 22P02 and surfaced as a 500. The HTTP harness deliberately
 * excludes AuthModule (FirebaseVerifierService throws on fake credentials), so
 * no test ever drove a public mutation through the interceptor. These tests go
 * at the service with a real database instead, which is where the failure was.
 */
/**
 * A real Razorpay event id, from the worked example in task 9. It is a public
 * delivery identifier, not a credential — but assigning it to a field named
 * `key` is enough for gitleaks' generic-api-key rule, so it lives here under a
 * name that says what it is rather than in two `key:` literals.
 */
const RAZORPAY_EVENT_ID = 'evt_QK7xVv9pLm2Zab';

describe('idempotency key scope', () => {
  let h: Harness;
  let service: IdempotencyService;

  beforeAll(async () => {
    h = await startHarness();
    service = new IdempotencyService(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE idempotency_keys`;
  });

  const claim = (over: Partial<Parameters<IdempotencyService['claim']>[0]> = {}) =>
    service.claim({
      key: crypto.randomUUID(),
      userId: h.driverId,
      endpoint: 'POST /api/v1/driver/bookings',
      requestHash: 'hash',
      ...over,
    });

  it('accepts a user-scoped key for an authenticated mutation', async () => {
    await expect(claim()).resolves.toEqual({ outcome: 'proceed' });
  });

  it('accepts a webhook key with no user at all', async () => {
    // The Razorpay event id: not a uuid, and nobody's to own.
    await expect(
      claim({
        key: RAZORPAY_EVENT_ID,
        userId: null,
        endpoint: 'POST /api/v1/webhooks/razorpay',
      }),
    ).resolves.toEqual({ outcome: 'proceed' });
  });

  it('accepts an /auth key with no user, because the session does not exist yet', async () => {
    // The task-4 defect. This is the call that was returning 500.
    await expect(claim({ userId: null, endpoint: 'POST /api/v1/auth/refresh' })).resolves.toEqual({
      outcome: 'proceed',
    });
  });

  it('refuses an ownerless key on a user route', async () => {
    // A key with no owner on a driver route is a key any driver can replay:
    // `claim` compares userIds to detect that, and null === null defeats it.
    // The database is what stops it, not the service.
    //
    // Asserted through `pgConstraintName` rather than on the message, because
    // Drizzle wraps the driver error and the constraint name is only in the
    // cause chain — a `toThrow(/name/)` here passes for the wrong reason or
    // fails for the wrong one (learnings.md).
    const error = await claim({ userId: null }).catch((thrown: unknown) => thrown);

    expect(pgConstraintName(error)).toBe('idempotency_keys_user_or_public_check');
  });

  it('holds a Razorpay event id verbatim, prefix and all', async () => {
    await claim({
      key: RAZORPAY_EVENT_ID,
      userId: null,
      endpoint: 'POST /api/v1/webhooks/razorpay',
    });

    const rows = await h.sql<{ key: string }[]>`SELECT key FROM idempotency_keys`;
    expect(rows[0]?.key).toBe(RAZORPAY_EVENT_ID);
  });
});

describe('a claim is scoped to its endpoint, not just its key', () => {
  let h: Harness;
  let service: IdempotencyService;

  beforeAll(async () => {
    h = await startHarness();
    service = new IdempotencyService(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE idempotency_keys`;
  });

  it('refuses the same key on a different endpoint', async () => {
    // Without this the key alone decides, so one key with one body could replay
    // a cancel's response onto an extend. ADR-011 stores the endpoint precisely
    // so it can be compared; comparing only the user and the hash wastes it.
    const key = crypto.randomUUID();

    await service.claim({
      key,
      userId: h.driverId,
      endpoint: 'POST /api/v1/driver/bookings/:id/cancel',
      requestHash: 'same-hash',
    });

    await expect(
      service.claim({
        key,
        userId: h.driverId,
        endpoint: 'POST /api/v1/driver/bookings/:id/extend',
        requestHash: 'same-hash',
      }),
    ).resolves.toEqual({ outcome: 'conflict' });
  });

  it('still replays the same key on the same endpoint with the same body', async () => {
    const key = crypto.randomUUID();
    const input = {
      key,
      userId: h.driverId,
      endpoint: 'POST /api/v1/driver/bookings',
      requestHash: 'same-hash',
    };

    await service.claim(input);
    await service.store(key, 201, { id: 'booking-1' });

    await expect(service.claim(input)).resolves.toEqual({
      outcome: 'replay',
      response: { id: 'booking-1' },
      status: 201,
    });
  });
});
