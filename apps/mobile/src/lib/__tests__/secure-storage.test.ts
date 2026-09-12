import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
}));

vi.mock('zod', async () => {
  const actual = await vi.importActual<typeof import('zod')>('zod');
  return actual;
});

import { secureStorage, type StoredSession } from '../secure-storage';

beforeEach(() => {
  store.clear();
});

describe('secureStorage', () => {
  const session: StoredSession = {
    accessToken: 'access-123',
    refreshToken: 'refresh-456',
    roles: ['driver', 'owner'] as StoredSession['roles'],
    activeRole: 'driver' as StoredSession['activeRole'],
  };

  it('round-trips write then read', async () => {
    await secureStorage.write(session);
    const result = await secureStorage.read();

    expect(result).toEqual(session);
  });

  it('returns null when no tokens stored', async () => {
    const result = await secureStorage.read();
    expect(result).toBeNull();
  });

  it('returns null when only partial data exists', async () => {
    store.set('parkease.accessToken', 'token');
    const result = await secureStorage.read();
    expect(result).toBeNull();
  });

  it('returns null on corrupted session meta (logs user out cleanly)', async () => {
    store.set('parkease.accessToken', 'token');
    store.set('parkease.refreshToken', 'token');
    store.set('parkease.sessionMeta', '{invalid json!!!');

    const result = await secureStorage.read();
    expect(result).toBeNull();
  });

  it('returns null when session meta has invalid schema', async () => {
    store.set('parkease.accessToken', 'token');
    store.set('parkease.refreshToken', 'token');
    store.set('parkease.sessionMeta', JSON.stringify({ roles: 'not-an-array' }));

    const result = await secureStorage.read();
    expect(result).toBeNull();
  });

  it('clears all three keys', async () => {
    await secureStorage.write(session);
    await secureStorage.clear();

    expect(store.size).toBe(0);
    const result = await secureStorage.read();
    expect(result).toBeNull();
  });
});
