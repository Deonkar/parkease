import MockAdapter from 'axios-mock-adapter';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { api, newIntent, registerSessionExpiredHandler } from '../api';
import { secureStorage, type StoredSession } from '../secure-storage';

vi.mock('../secure-storage', () => ({
  secureStorage: {
    read: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('../uuid', () => ({
  uuidv7: vi.fn(() => `mock-uuid-${String(Math.random()).slice(2, 8)}`),
}));

const mock = new MockAdapter(api);

const fakeSession: StoredSession = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  roles: ['driver'] as StoredSession['roles'],
  activeRole: 'driver' as StoredSession['activeRole'],
};

const newTokens = {
  data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
};

/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on module mock stubs */
function setupStorageMock(): void {
  let currentSession: StoredSession | null = { ...fakeSession };
  vi.mocked(secureStorage.read).mockImplementation(() => Promise.resolve(currentSession));
  vi.mocked(secureStorage.write).mockImplementation((s: StoredSession) => {
    currentSession = { ...s };
    return Promise.resolve();
  });
  vi.mocked(secureStorage.clear).mockImplementation(() => {
    currentSession = null;
    return Promise.resolve();
  });
}
/* eslint-enable @typescript-eslint/unbound-method */

beforeEach(() => {
  mock.reset();
  setupStorageMock();
  registerSessionExpiredHandler(async () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('idempotency key enforcement', () => {
  it('throws when a POST has no Idempotency-Key', async () => {
    mock.onPost('/test').reply(200, { data: {} });

    await expect(api.post('/test', {})).rejects.toThrow('POST /test has no Idempotency-Key');
  });

  it('allows POST with Idempotency-Key', async () => {
    mock.onPost('/test').reply(200, { data: 'ok' });

    const intent = newIntent();
    const res = await api.post(
      '/test',
      {},
      {
        headers: { 'Idempotency-Key': intent.idempotencyKey },
      },
    );

    expect(res.data).toEqual({ data: 'ok' });
  });

  it('does not require Idempotency-Key on GET', async () => {
    mock.onGet('/test').reply(200, { data: 'ok' });

    const res = await api.get('/test');
    expect(res.data).toEqual({ data: 'ok' });
  });
});

describe('auth header', () => {
  it('attaches Bearer token from secure storage', async () => {
    mock.onGet('/me').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer old-access');
      return [200, { data: {} }];
    });

    await api.get('/me');
  });

  it('skips auth header when _skipAuth is set', async () => {
    mock.onPost('/auth/refresh').reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [200, newTokens];
    });

    await api.post('/auth/refresh', {}, {
      _skipAuth: true,
      headers: { 'Idempotency-Key': 'test-key' },
    } as never);
  });
});

describe('single-flight refresh', () => {
  it('calls /auth/refresh exactly once for 5 concurrent 401s', async () => {
    let refreshCallCount = 0;
    let callIndex = 0;

    mock.onGet('/resource').reply(() => {
      callIndex++;
      if (callIndex <= 5) return [401, { error: { code: 'UNAUTHORIZED' } }];
      return [200, { data: 'refreshed' }];
    });

    mock.onPost('/auth/refresh').reply(() => {
      refreshCallCount++;
      return [200, newTokens];
    });

    const results = await Promise.all([
      api.get('/resource'),
      api.get('/resource'),
      api.get('/resource'),
      api.get('/resource'),
      api.get('/resource'),
    ]);

    expect(refreshCallCount).toBe(1);
    for (const res of results) {
      expect(res.data).toEqual({ data: 'refreshed' });
    }
  });

  it('replays carry the new access token', async () => {
    let firstCall = true;

    mock.onGet('/resource').reply((config) => {
      if (firstCall) {
        firstCall = false;
        return [401, { error: { code: 'UNAUTHORIZED' } }];
      }
      return [200, { data: { token: config.headers?.Authorization as string } }];
    });

    mock.onPost('/auth/refresh').reply(200, newTokens);

    const res = await api.get<{ data: { token: string } }>('/resource');

    expect(res.data.data.token).toBe('Bearer new-access');
  });

  it('replays carry the same Idempotency-Key', async () => {
    let firstCall = true;
    let replayKey: string | undefined;

    mock.onPost('/mutation').reply((config) => {
      if (firstCall) {
        firstCall = false;
        return [401, { error: { code: 'UNAUTHORIZED' } }];
      }
      replayKey = config.headers?.['Idempotency-Key'] as string | undefined;
      return [200, { data: 'ok' }];
    });

    mock.onPost('/auth/refresh').reply(200, newTokens);

    const intent = newIntent();
    await api.post(
      '/mutation',
      {},
      {
        headers: { 'Idempotency-Key': intent.idempotencyKey },
      },
    );

    expect(replayKey).toBe(intent.idempotencyKey);
  });

  it('does not retry a request that already retried once', async () => {
    mock.onGet('/resource').reply(401);
    mock.onPost('/auth/refresh').reply(200, newTokens);

    await expect(api.get('/resource')).rejects.toThrow();
  });

  it('does not recurse when /auth/refresh itself returns 401', async () => {
    let firstCall = true;
    mock.onGet('/resource').reply(() => {
      if (firstCall) {
        firstCall = false;
        return [401, { error: { code: 'UNAUTHORIZED' } }];
      }
      return [200, { data: 'ok' }];
    });
    mock.onPost('/auth/refresh').reply(401);

    const expiredHandler = vi.fn(async () => {});
    registerSessionExpiredHandler(expiredHandler);

    await expect(api.get('/resource')).rejects.toThrow();

    const refreshCalls = mock.history.post.filter((r) => r.url?.includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('calls session-expired handler on failed refresh', async () => {
    let firstCall = true;
    mock.onGet('/resource').reply(() => {
      if (firstCall) {
        firstCall = false;
        return [401, {}];
      }
      return [200, { data: 'ok' }];
    });
    mock.onPost('/auth/refresh').reply(500);

    const expiredHandler = vi.fn(async () => {});
    registerSessionExpiredHandler(expiredHandler);

    await expect(api.get('/resource')).rejects.toThrow();
    expect(expiredHandler).toHaveBeenCalledOnce();
  });

  it('does not trigger refresh on 403', async () => {
    mock.onGet('/resource').reply(403);

    await expect(api.get('/resource')).rejects.toThrow();

    const refreshCalls = mock.history.post.filter((r) => r.url?.includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(0);
  });

  it('does not trigger refresh on network error', async () => {
    mock.onGet('/resource').networkError();

    await expect(api.get('/resource')).rejects.toThrow();

    const refreshCalls = mock.history.post.filter((r) => r.url?.includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(0);
  });

  it('starts a new refresh after the first one settles', async () => {
    let callCount = 0;
    let refreshCount = 0;

    mock.onGet('/resource').reply(() => {
      callCount++;
      if (callCount === 1 || callCount === 3) {
        return [401, {}];
      }
      return [200, { data: 'ok' }];
    });

    mock.onPost('/auth/refresh').reply(() => {
      refreshCount++;
      return [
        200,
        {
          data: {
            accessToken: `access-${String(refreshCount)}`,
            refreshToken: `refresh-${String(refreshCount)}`,
          },
        },
      ];
    });

    await api.get('/resource');
    expect(refreshCount).toBe(1);

    await api.get('/resource');
    expect(refreshCount).toBe(2);
  });
});
