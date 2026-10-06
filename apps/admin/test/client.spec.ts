import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, request, withQuery } from '../src/lib/api';
import { formatInr } from '../src/lib/money';
import { refreshOnce } from '../src/lib/session';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = {
  data: {
    accessToken: 'tok',
    expiresIn: 900,
    user: { id: '0192f1c0-0000-7000-8000-000000000001', roles: ['admin'] },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatInr', () => {
  it('groups in lakhs and shows paise only when there are some', () => {
    expect(formatInr(42_000_000)).toBe('₹4,20,000');
    expect(formatInr(9702)).toBe('₹97.02');
    expect(formatInr(0)).toBe('₹0');
  });
});

describe('withQuery', () => {
  it('drops empty filters so they never reach the API', () => {
    expect(withQuery('/admin/users', { q: '', role: undefined, page: 2 })).toBe(
      '/admin/users?page=2',
    );
  });
});

describe('request', () => {
  it('refreshes once for concurrent 401s and retries each request with the new token', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push(url);
        if (url.endsWith('/auth/admin/refresh')) return Promise.resolve(json(200, session));
        const authorised = new Headers(init.headers).get('authorization') === 'Bearer tok';
        return Promise.resolve(
          authorised
            ? json(200, { data: { ok: true } })
            : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
        );
      }),
    );

    const schema = z.object({ ok: z.boolean() });
    const [a, b] = await Promise.all([request(schema, '/admin/a'), request(schema, '/admin/b')]);

    expect(a.data.ok && b.data.ok).toBe(true);
    // Two refreshes would present an already-rotated cookie and trip reuse detection.
    expect(calls.filter((u) => u.endsWith('/refresh'))).toHaveLength(1);
  });

  it('turns the error envelope into an ApiError carrying the code and trace id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(json(403, { error: { code: 'FORBIDDEN', message: 'No', traceId: 't-1' } })),
      ),
    );
    const failure = await request(z.unknown(), '/admin/users').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: 'FORBIDDEN', traceId: 't-1' });
  });

  it('refuses a response that does not match the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(200, { data: { ok: 'yes' } }))),
    );
    await expect(request(z.object({ ok: z.boolean() }), '/admin/x')).rejects.toThrow();
  });

  it('signs out when the refresh cookie is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }))),
    );
    await expect(refreshOnce()).resolves.toBe(false);
  });
});
