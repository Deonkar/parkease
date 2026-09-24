import { randomUUID } from 'node:crypto';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TraceFlags, trace } from '@opentelemetry/api';
import { firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyInterceptor } from '../src/platform/idempotency/idempotency.interceptor.js';
import type { IdempotencyService } from '../src/platform/idempotency/idempotency.service.js';
import { logger } from '../src/platform/observability/logger.js';

/**
 * Silent failure H1 (task 14 final fix wave). The interceptor wrote the stored
 * response and released a failed attempt's key as `void` promises. When one of
 * those writes failed, nothing saw it: the key sat `in_flight` for 24 hours, and
 * since REQUEST_IN_FLIGHT tells the client to keep its key and retry, every
 * retry hit the same wall. Both writes are now observed — a failure is logged at
 * warn with the trace id and the key, and never becomes an unhandled rejection
 * or changes what the caller already got.
 *
 * The stale-lock guard rails (task 14 server fix wave) add three things: a
 * failed store is retried once, because a committed write left unstored can be
 * re-run once the key goes stale; both writes carry the claim they came from;
 * and a write that finds its claim taken over says so at warn.
 */

/** Minted at runtime: a uuid literal on a name ending in `KEY` trips gitleaks' generic-api-key rule. */
const KEY = randomUUID();

/** The W3C trace-context example trace id: a real, well-formed id, not "any string". */
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const contextFor = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/washer/jobs/x/accept',
        headers: { 'idempotency-key': KEY },
        body: {},
        user: { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c' },
        routeOptions: { url: '/api/v1/washer/jobs/:id/accept' },
      }),
    }),
  }) as unknown as ExecutionContext;

type Write = () => Promise<boolean>;

const serviceWith = (over: Partial<Record<'store' | 'release', Write>>) => {
  const service = {
    claim: vi.fn().mockResolvedValue({ outcome: 'proceed' }),
    store: vi.fn(over.store ?? (() => Promise.resolve(true))),
    release: vi.fn(over.release ?? (() => Promise.resolve(true))),
  };
  return { service, typed: service as unknown as IdempotencyService };
};

/** The claim token the interceptor handed to `claim`, which store and release must carry. */
const claimedAtOf = (service: { claim: { mock: { calls: unknown[][] } } }): unknown =>
  (service.claim.mock.calls[0]?.[0] as { claimedAt?: unknown } | undefined)?.claimedAt;

/**
 * Runs one request through the interceptor with a span active only while
 * `intercept` itself runs — the request phase. The handler and the detached
 * write settle after it, the way they do in production, so an interceptor that
 * read the trace id late would log 'untraced' and fail the exact-id assertion.
 */
const run = async (interceptor: IdempotencyInterceptor, next: CallHandler) => {
  const active = vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
    trace.wrapSpanContext({
      traceId: TRACE_ID,
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    }),
  );
  const answer = await interceptor.intercept(contextFor(), next);
  active.mockRestore();
  return firstValueFrom(answer);
};

/** Lets the interceptor's detached writes (and a retry) settle before the assertions read the log. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const logged = { key: KEY, traceId: TRACE_ID };

describe('IdempotencyInterceptor — the store and release writes are observed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a failed store once, then logs at warn with the key and trace id, and still answers', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { service, typed } = serviceWith({ store: () => Promise.reject(new Error('db down')) });
    const next: CallHandler = { handle: () => of({ ok: true }) };

    const answer = await run(new IdempotencyInterceptor(typed), next);
    await settle();

    expect(answer).toEqual({ ok: true });
    expect(service.store).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining(logged),
      expect.stringMatching(/store failed twice/i),
    );
  });

  it('logs the first store failure and stays quiet once the retry lands', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const { service, typed } = serviceWith({
      store: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve(true);
      },
    });

    const answer = await run(new IdempotencyInterceptor(typed), { handle: () => of({ ok: 1 }) });
    await settle();

    expect(answer).toEqual({ ok: 1 });
    expect(service.store).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining(logged),
      expect.stringMatching(/retrying once/i),
    );
  });

  it('stores under the claim it took, not the key alone', async () => {
    const { service, typed } = serviceWith({});

    await run(new IdempotencyInterceptor(typed), { handle: () => of({ ok: true }) });
    await settle();

    const claimedAt = claimedAtOf(service);
    expect(claimedAt).toBeInstanceOf(Date);
    expect(service.store).toHaveBeenCalledWith(KEY, 200, { ok: true }, claimedAt);
  });

  it('releases under the claim it took, not the key alone', async () => {
    const { service, typed } = serviceWith({});

    await expect(
      run(new IdempotencyInterceptor(typed), { handle: () => throwError(() => new Error('nope')) }),
    ).rejects.toThrow('nope');
    await settle();

    const claimedAt = claimedAtOf(service);
    expect(claimedAt).toBeInstanceOf(Date);
    expect(service.release).toHaveBeenCalledWith(KEY, claimedAt);
  });

  it('logs at warn when the store finds its claim taken over by a newer retry', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { service, typed } = serviceWith({ store: () => Promise.resolve(false) });

    await run(new IdempotencyInterceptor(typed), { handle: () => of({ ok: true }) });
    await settle();

    // A lost claim is not a failed write: retrying it would only lose again.
    expect(service.store).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining(logged),
      expect.stringMatching(/store matched no claim/i),
    );
  });

  it('logs a failed release at warn, and still rethrows the handler error', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { typed } = serviceWith({ release: () => Promise.reject(new Error('db down')) });
    const failure = new Error('handler failed');
    const next: CallHandler = { handle: () => throwError(() => failure) };

    await expect(run(new IdempotencyInterceptor(typed), next)).rejects.toBe(failure);
    await settle();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining(logged),
      expect.stringMatching(/release failed/i),
    );
  });

  it('logs at warn when the release finds its claim taken over by a newer retry', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { typed } = serviceWith({ release: () => Promise.resolve(false) });
    const failure = new Error('handler failed');

    await expect(
      run(new IdempotencyInterceptor(typed), { handle: () => throwError(() => failure) }),
    ).rejects.toBe(failure);
    await settle();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining(logged),
      expect.stringMatching(/release matched no claim/i),
    );
  });
});
