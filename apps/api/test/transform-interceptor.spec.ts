import { of, lastValueFrom } from 'rxjs';
import { describe, it, expect } from 'vitest';

import { TransformInterceptor } from '../src/platform/http/transform.interceptor.js';

function makeContext(url: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
    }),
  } as never;
}

function makeHandler(payload: unknown) {
  return { handle: () => of(payload) } as never;
}

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  it('wraps a single-item response in { data }', async () => {
    const obs = interceptor.intercept(
      makeContext('/api/v1/driver/bookings/1'),
      makeHandler({ id: '1', status: 'confirmed' }),
    );
    const result = await lastValueFrom(obs);
    expect(result).toEqual({ data: { id: '1', status: 'confirmed' } });
  });

  it('wraps a paged response in { data, meta }', async () => {
    const paged = {
      items: [{ id: '1' }, { id: '2' }],
      meta: { total: 10, limit: 2, hasMore: true, nextCursor: 'abc' },
    };
    const obs = interceptor.intercept(makeContext('/api/v1/driver/bookings'), makeHandler(paged));
    const result = await lastValueFrom(obs);
    expect(result).toEqual({
      data: paged.items,
      meta: paged.meta,
    });
  });

  it('does NOT wrap GET /api/v1/health', async () => {
    const healthPayload = { status: 'ok', version: '1.0.0', timestamp: '2026-01-01' };
    const obs = interceptor.intercept(makeContext('/api/v1/health'), makeHandler(healthPayload));
    const result = await lastValueFrom(obs);
    expect(result).toEqual(healthPayload);
  });
});
