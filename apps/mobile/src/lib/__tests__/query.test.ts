import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadFailureCopy, OUTDATED_COPY } from '@/features/shared/api/failure';

import { queryDefaults, shouldRetryQuery } from '../query';

/** A client on the app's own defaults, with no backoff so a retry is immediate. */
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      ...queryDefaults,
      queries: { ...queryDefaults.queries, retryDelay: 0 },
    },
  });
}

/** Runs one query to its settled state and reports how often the fetcher ran. */
async function settle(fetcher: () => Promise<unknown>) {
  let calls = 0;
  const observer = new QueryObserver(client(), {
    queryKey: ['probe'],
    queryFn: async () => {
      calls += 1;
      return fetcher();
    },
  });
  const result = await new Promise<ReturnType<typeof observer.getCurrentResult>>((resolve) => {
    const unsubscribe = observer.subscribe((next) => {
      if (next.status !== 'pending') {
        unsubscribe();
        resolve(next);
      }
    });
  });
  return { calls, result };
}

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${String(status)}`), {
    response: { status, data: { error: { code: 'X', message: 'x' } } },
  });

describe('the default query retry (S-76)', () => {
  it('fetches an unparseable 2xx once and lands on "Update the app"', async () => {
    const schema = z.object({ id: z.string() });
    const { calls, result } = await settle(() => Promise.resolve(schema.parse({ id: 42 })));

    expect(calls).toBe(1);
    expect(result.isError).toBe(true);
    expect(loadFailureCopy(result.error)).toBe(OUTDATED_COPY);
  });

  it('fetches a definite 4xx once', async () => {
    const { calls } = await settle(() => Promise.reject(httpError(404)));
    expect(calls).toBe(1);
  });

  it('retries a dead connection twice', async () => {
    const offline = Object.assign(new Error('Network Error'), { request: {} });
    const { calls } = await settle(() => Promise.reject(offline));
    expect(calls).toBe(3);
  });

  it.each([408, 429, 500, 503])('retries a %i', (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(true);
    expect(shouldRetryQuery(2, httpError(status))).toBe(false);
  });
});
