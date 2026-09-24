import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { defer, firstValueFrom, of } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyInterceptor } from '../../src/platform/idempotency/idempotency.interceptor.js';
import {
  IDEMPOTENCY_IN_FLIGHT_STALE_MS,
  IdempotencyService,
  hashCanonicalBody,
} from '../../src/platform/idempotency/idempotency.service.js';
import { logger } from '../../src/platform/observability/logger.js';

import { type Harness, startHarness, stopHarness } from './harness.js';

/**
 * Guard rails on the stale-lock takeover (task 14 server fix wave).
 *
 * C1 let a retry take over an `in_flight` claim older than
 * `IDEMPOTENCY_IN_FLIGHT_STALE_MS`. The re-review found what that opened: a
 * handler that commits its write and then fails to store leaves the key
 * unfinished, and the retry that takes it over runs the handler a second time.
 * These tests pin the rails that keep that rare and keep it from compounding —
 * against a real database, because every one of them is a property of a
 * conditional write racing another connection.
 */

const ENDPOINT = 'POST /api/v1/driver/bookings';
const BODY = { spaceId: 'space-1', vehicleType: 'car' };

/** Old enough that any retry may take the claim over. */
const STALE_SECONDS = IDEMPOTENCY_IN_FLIGHT_STALE_MS / 1000 + 60;
const staleClaimTime = () => new Date(Date.now() - IDEMPOTENCY_IN_FLIGHT_STALE_MS - 60_000);

describe('the stale-lock takeover', () => {
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

  const input = (key: string, claimedAt?: Date) => ({
    key,
    userId: h.driverId,
    endpoint: ENDPOINT,
    requestHash: hashCanonicalBody(BODY),
    ...(claimedAt ? { claimedAt } : {}),
  });

  const rowOf = async (key: string) => {
    const rows = await h.sql<{ response_status: number | null; response_body: unknown }[]>`
      SELECT response_status, response_body FROM idempotency_keys WHERE key = ${key}
    `;
    return rows[0];
  };

  /** The request the interceptor sees for a retry on `key`: same user, route and body every time. */
  const contextFor = (key: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/v1/driver/bookings',
          headers: { 'idempotency-key': key },
          body: BODY,
          user: { id: h.driverId },
          routeOptions: { url: '/api/v1/driver/bookings' },
        }),
      }),
    }) as unknown as ExecutionContext;

  describe('two stale retries at once', () => {
    it('lets exactly one take the claim over and run the handler', async () => {
      // Ten keys, two retries each, all at once: one pair racing could
      // serialise by luck, twenty statements on a ten-connection pool cannot.
      const keys = Array.from({ length: 10 }, () => crypto.randomUUID());
      for (const key of keys) {
        await service.claim(input(key, staleClaimTime()));
      }

      const interceptor = new IdempotencyInterceptor(service);
      const runs = new Map<string, number>();
      const retry = async (key: string) => {
        const next: CallHandler = {
          handle: () => {
            runs.set(key, (runs.get(key) ?? 0) + 1);
            return of({ bookingId: `booking-for-${key}` });
          },
        };
        return firstValueFrom(await interceptor.intercept(contextFor(key), next));
      };

      const outcomes = await Promise.allSettled(keys.flatMap((key) => [retry(key), retry(key)]));

      for (const [i, key] of keys.entries()) {
        const pair = outcomes.slice(i * 2, i * 2 + 2);
        expect(runs.get(key)).toBe(1);
        expect(pair.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
        const [refused] = pair.filter((o) => o.status === 'rejected');
        expect(refused?.reason).toBeInstanceOf(ConflictException);
        expect((refused?.reason as ConflictException).getResponse()).toMatchObject({
          error: 'REQUEST_IN_FLIGHT',
        });
      }

      // The winner stored its answer under its own claim. Polled: the store
      // is detached from the response by design.
      await vi.waitFor(async () => {
        for (const key of keys) {
          expect((await rowOf(key))?.response_status).toBe(200);
        }
      });
    });
  });

  describe('a zombie attempt slower than the threshold', () => {
    it('cannot store over a claim a newer retry has taken over', async () => {
      const key = crypto.randomUUID();
      const zombie = staleClaimTime();
      await service.claim(input(key, zombie));

      const retry = new Date();
      await expect(service.claim(input(key, retry))).resolves.toEqual({ outcome: 'proceed' });

      // The zombie finishes late. Its write must not land on the retry's claim:
      // the retry is still running, and a stored response would make every
      // later retry replay the zombie's answer instead.
      await expect(service.store(key, 200, { from: 'zombie' }, zombie)).resolves.toBe(false);
      expect((await rowOf(key))?.response_body).toBeNull();

      await expect(service.store(key, 200, { from: 'retry' }, retry)).resolves.toBe(true);
      await expect(service.claim(input(key))).resolves.toEqual({
        outcome: 'replay',
        response: { from: 'retry' },
        status: 200,
      });
    });

    it('cannot release a claim a newer retry has taken over', async () => {
      const key = crypto.randomUUID();
      const zombie = staleClaimTime();
      await service.claim(input(key, zombie));
      const retry = new Date();
      await service.claim(input(key, retry));

      // Deleting the key would let a third attempt claim it fresh and run
      // alongside the retry that holds it.
      await expect(service.release(key, zombie)).resolves.toBe(false);
      expect(await rowOf(key)).toBeDefined();
      await expect(service.claim(input(key))).resolves.toEqual({ outcome: 'in_flight' });

      await expect(service.release(key, retry)).resolves.toBe(true);
      expect(await rowOf(key)).toBeUndefined();
    });

    it('logs at warn when the interceptor finds its claim taken over', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const key = crypto.randomUUID();
      const interceptor = new IdempotencyInterceptor(service);

      // The zombie's handler stalls past the threshold; a retry takes over
      // mid-handler, then the zombie's handler returns and tries to store.
      const zombieDone = firstValueFrom(
        await interceptor.intercept(contextFor(key), {
          handle: () =>
            defer(async () => {
              // Ages the zombie's claim the way five real minutes would, then
              // lets a retry take it over while this handler is still running.
              await h.sql`
                UPDATE idempotency_keys
                SET locked_at = locked_at - make_interval(secs => ${STALE_SECONDS})
                WHERE key = ${key}
              `;
              await expect(service.claim(input(key, new Date()))).resolves.toEqual({
                outcome: 'proceed',
              });
              return { from: 'zombie' };
            }),
        }),
      );

      await expect(zombieDone).resolves.toEqual({ from: 'zombie' });
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ key }),
          expect.stringMatching(/store matched no claim/i),
        );
      });
      expect((await rowOf(key))?.response_body).toBeNull();
      warn.mockRestore();
    });
  });
});
