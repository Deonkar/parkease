import { AsyncResource } from 'node:async_hooks';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { defer, firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookService } from '../../src/domains/payment/webhook.service.js';
import { withTransaction } from '../../src/platform/db/transaction.js';
import {
  ClaimSupersededError,
  idempotencyClaim,
} from '../../src/platform/idempotency/claim-context.js';
import { IdempotencyInterceptor } from '../../src/platform/idempotency/idempotency.interceptor.js';
import {
  IDEMPOTENCY_IN_FLIGHT_STALE_MS,
  IdempotencyService,
  hashCanonicalBody,
  legacyHashCanonicalBody,
} from '../../src/platform/idempotency/idempotency.service.js';
import { logger } from '../../src/platform/observability/logger.js';

import { type Harness, startHarness, stopHarness } from './harness.js';

/**
 * S-64: a takeover re-runs the handler, so two things must never happen. A slow attempt whose key
 * was taken over must not commit beside its replacement, and a write that committed must not be
 * run again because its response was lost. Both are closed by the commit fence: the domain
 * transaction marks its own claim `committed_at`, in the same transaction, only while the claim
 * still holds the key. Real PostgreSQL, because each case is a conditional write racing another.
 */
const ENDPOINT = 'POST /api/v1/driver/bookings';
const BODY = { spaceId: 'space-1', vehicleType: 'car' };
const stale = () => new Date(Date.now() - IDEMPOTENCY_IN_FLIGHT_STALE_MS - 60_000);

describe('the idempotency commit fence', () => {
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
    await h.sql`TRUNCATE idempotency_keys, outbox_messages`;
  });

  const claim = (key: string, claimedAt: Date) =>
    service.claim({
      key,
      userId: h.driverId,
      endpoint: ENDPOINT,
      requestHash: hashCanonicalBody(BODY),
      claimedAt,
    });

  /** A domain write: one outbox row, the cheapest thing a command commits. */
  const write = (marker: string) =>
    withTransaction(h.db, async (tx) => {
      await tx.execute(
        sql`INSERT INTO outbox_messages (type, payload)
            VALUES ('test.fence', ${JSON.stringify({ m: marker })}::jsonb)`,
      );
    });

  const writes = async () =>
    (await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM outbox_messages`)[0]?.n;

  const committedAt = async (key: string) =>
    (
      await h.sql<{ committed_at: Date | null }[]>`
        SELECT committed_at FROM idempotency_keys WHERE key = ${key}`
    )[0]?.committed_at ?? null;

  it('lets the claim holder commit, and marks the claim committed in the same transaction', async () => {
    const key = crypto.randomUUID();
    const at = new Date();
    await claim(key, at);

    await idempotencyClaim.run({ key, claimedAt: at }, () => write('holder'));

    expect(await writes()).toBe(1);
    expect(await committedAt(key)).not.toBeNull();
  });

  it('rolls a taken-over attempt back at its commit', async () => {
    const key = crypto.randomUUID();
    const zombie = stale();
    await claim(key, zombie);
    // The retry finds the claim stale and takes it over.
    await expect(claim(key, new Date())).resolves.toEqual({ outcome: 'proceed' });

    // The zombie finally reaches its commit.
    await expect(
      idempotencyClaim.run({ key, claimedAt: zombie }, () => write('zombie')),
    ).rejects.toBeInstanceOf(ClaimSupersededError);

    expect(await writes()).toBe(0);
    expect(await committedAt(key)).toBeNull();
  });

  it('does not mark a read-only transaction, which has nothing to repeat', async () => {
    const key = crypto.randomUUID();
    const at = new Date();
    await claim(key, at);

    await idempotencyClaim.run({ key, claimedAt: at }, () =>
      withTransaction(h.db, async (tx) => tx.execute(sql`SELECT 1`)),
    );

    expect(await committedAt(key)).toBeNull();
  });

  it('never re-runs a committed write whose response was lost', async () => {
    const key = crypto.randomUUID();
    const first = stale();
    await claim(key, first);
    await idempotencyClaim.run({ key, claimedAt: first }, () => write('first'));
    // ...and the store never happened.

    await expect(claim(key, new Date())).resolves.toEqual({ outcome: 'committed' });
    expect(await writes()).toBe(1);
  });

  it('answers in flight while a fresh committed attempt is about to store', async () => {
    const key = crypto.randomUUID();
    const at = new Date();
    await claim(key, at);
    await idempotencyClaim.run({ key, claimedAt: at }, () => write('fresh'));

    await expect(claim(key, new Date())).resolves.toEqual({ outcome: 'in_flight' });
  });

  it('keeps a committed claim on release, and the retry is told it already applied', async () => {
    const key = crypto.randomUUID();
    const at = new Date();
    await claim(key, at);
    await idempotencyClaim.run({ key, claimedAt: at }, () => write('then-500'));

    await expect(service.release(key, at)).resolves.toBe(true);

    await expect(claim(key, new Date())).resolves.toEqual({ outcome: 'committed' });
  });

  it('deletes a committed claim when the failure is one a retry should resume', async () => {
    const key = crypto.randomUUID();
    const at = new Date();
    await claim(key, at);
    await idempotencyClaim.run({ key, claimedAt: at }, () => write('saved-step'));

    await expect(service.release(key, at, { rerunnable: true })).resolves.toBe(true);

    await expect(claim(key, new Date())).resolves.toEqual({ outcome: 'proceed' });
  });

  describe('through the interceptor', () => {
    const contextFor = (key: string): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            url: '/api/v1/driver/bookings',
            headers: { 'idempotency-key': key },
            body: BODY,
            params: {},
            user: { id: h.driverId },
            routeOptions: { url: '/api/v1/driver/bookings' },
          }),
        }),
      }) as unknown as ExecutionContext;

    const interceptor = () => new IdempotencyInterceptor(service);

    it('runs the handler inside its claim, so the handler s write is fenced', async () => {
      const key = crypto.randomUUID();
      // Unbound, deliberately: the interceptor must not depend on Nest binding `handle()`.
      const next: CallHandler = { handle: () => defer(() => write('via-interceptor')) };

      await firstValueFrom(await interceptor().intercept(contextFor(key), next));

      expect(await committedAt(key)).not.toBeNull();
    });

    it('works the same when Nest binds the handler, as it does in the app', async () => {
      const key = crypto.randomUUID();
      const next: CallHandler = {
        handle: () => defer(AsyncResource.bind(() => write('bound'))),
      };

      await firstValueFrom(await interceptor().intercept(contextFor(key), next));

      expect(await committedAt(key)).not.toBeNull();
    });

    it('answers 409 REQUEST_ALREADY_APPLIED to a retry of a committed write', async () => {
      const key = crypto.randomUUID();
      const first = stale();
      await claim(key, first);
      await idempotencyClaim.run({ key, claimedAt: first }, () => write('lost-response'));
      const next: CallHandler = { handle: () => defer(() => write('must-not-run')) };

      const error = await interceptor()
        .intercept(contextFor(key), next)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        error: 'REQUEST_ALREADY_APPLIED',
      });
      expect(await writes()).toBe(1);
    });
  });

  describe('request hashes (S-101)', () => {
    it('stores an HMAC, never the plain SHA-256 of the body', async () => {
      const key = crypto.randomUUID();
      const next: CallHandler = { handle: () => defer(async () => ({ ok: true })) };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'PUT',
            url: '/api/v1/me/bank-details',
            headers: { 'idempotency-key': key },
            body: { accountNumber: '123456789012', ifsc: 'HDFC0001234' },
            params: {},
            user: { id: h.driverId },
            routeOptions: { url: '/api/v1/me/bank-details' },
          }),
        }),
      } as unknown as ExecutionContext;

      await firstValueFrom(await new IdempotencyInterceptor(service).intercept(ctx, next));

      const [row] = await h.sql<{ request_hash: string }[]>`
        SELECT request_hash FROM idempotency_keys WHERE key = ${key}`;
      expect(row?.request_hash).not.toBe(
        legacyHashCanonicalBody({ accountNumber: '123456789012', ifsc: 'HDFC0001234' }),
      );
    });

    it('still replays a key stored with the pre-HMAC hash', async () => {
      const key = crypto.randomUUID();
      await h.sql`
        INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_status,
                                      response_body, expires_at)
        VALUES (${key}, ${h.driverId}, ${ENDPOINT}, ${legacyHashCanonicalBody(BODY)}, 200,
                ${JSON.stringify({ id: 'booking-1' })}::jsonb, now() + interval '1 day')`;

      await expect(
        service.claim({
          key,
          userId: h.driverId,
          endpoint: ENDPOINT,
          requestHash: hashCanonicalBody(BODY),
          legacyRequestHash: legacyHashCanonicalBody(BODY),
        }),
      ).resolves.toMatchObject({ outcome: 'replay', response: { id: 'booking-1' } });
    });
  });

  describe('the webhook path (S-75)', () => {
    const body =
      '{"entity":"event","event":"payment.captured","payload":{"payment":{"entity":' +
      '{"id":"pay_Zombie000001","order_id":"order_Zombie00001","amount":9702,' +
      '"currency":"INR","status":"captured","method":"upi"}}}}';

    /** A webhook whose capture handler is overtaken by a redelivery while it runs. */
    const webhookWith = (confirm: () => Promise<unknown>) =>
      new WebhookService(
        { verifyWebhookSignature: () => undefined } as never,
        service,
        { execute: confirm } as never,
        {} as never,
        {} as never,
        {} as never,
      );

    it('a delivery overtaken by a redelivery cannot commit, store or release over it', async () => {
      const eventId = 'evt_ZombieDelivery01';
      const redeliveryAt = new Date(Date.now() + 1000);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const webhook = webhookWith(async () => {
        // The redelivery takes the key over while this delivery is still running.
        await h.sql`UPDATE idempotency_keys SET locked_at = ${redeliveryAt.toISOString()}::timestamptz WHERE key = ${eventId}`;
        await write('zombie-capture');
        return { outcome: 'confirmed' };
      });

      await expect(
        webhook.handle({ rawBody: Buffer.from(body), signature: 'ok', eventId }),
      ).rejects.toBeInstanceOf(ClaimSupersededError);

      expect(await writes()).toBe(0);
      const [row] = await h.sql<{ locked_at: Date | null; response_status: number | null }[]>`
        SELECT locked_at, response_status FROM idempotency_keys WHERE key = ${eventId}`;
      // Still the redelivery's claim: not stored over, not released.
      expect(row?.response_status).toBeNull();
      expect(new Date(String(row?.locked_at)).getTime()).toBe(redeliveryAt.getTime());
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId }),
        'webhook release matched no claim',
      );
      warn.mockRestore();
    });

    it('a delivery that holds its claim stores on it', async () => {
      const eventId = 'evt_HonestDelivery01';
      const webhook = webhookWith(async () => {
        await write('capture');
        return { outcome: 'confirmed' };
      });

      await webhook.handle({ rawBody: Buffer.from(body), signature: 'ok', eventId });

      const [row] = await h.sql<{ response_status: number | null; committed_at: Date | null }[]>`
        SELECT response_status, committed_at FROM idempotency_keys WHERE key = ${eventId}`;
      expect(row?.response_status).toBe(200);
      expect(row?.committed_at).not.toBeNull();
    });
  });
});
