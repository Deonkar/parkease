import { randomUUID } from 'node:crypto';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
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
 */

/** Minted at runtime: a uuid literal on a name ending in `KEY` trips gitleaks' generic-api-key rule. */
const KEY = randomUUID();

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

const serviceWith = (over: Partial<Record<'store' | 'release', () => Promise<void>>>) =>
  ({
    claim: vi.fn().mockResolvedValue({ outcome: 'proceed' }),
    store: vi.fn(over.store ?? (() => Promise.resolve())),
    release: vi.fn(over.release ?? (() => Promise.resolve())),
  }) as unknown as IdempotencyService;

/** Lets the interceptor's detached write settle before the assertions read the log. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('IdempotencyInterceptor — the store and release writes are observed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a failed store at warn with the key and trace id, and still answers', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const interceptor = new IdempotencyInterceptor(
      serviceWith({ store: () => Promise.reject(new Error('db down')) }),
    );
    const next: CallHandler = { handle: () => of({ ok: true }) };

    const answer = await firstValueFrom(await interceptor.intercept(contextFor(), next));
    await settle();

    expect(answer).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, traceId: expect.any(String) as unknown }),
      expect.stringMatching(/store/i),
    );
  });

  it('logs a failed release at warn, and still rethrows the handler error', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const interceptor = new IdempotencyInterceptor(
      serviceWith({ release: () => Promise.reject(new Error('db down')) }),
    );
    const failure = new Error('handler failed');
    const next: CallHandler = { handle: () => throwError(() => failure) };

    await expect(firstValueFrom(await interceptor.intercept(contextFor(), next))).rejects.toBe(
      failure,
    );
    await settle();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, traceId: expect.any(String) as unknown }),
      expect.stringMatching(/release/i),
    );
  });
});
