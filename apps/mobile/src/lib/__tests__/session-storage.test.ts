import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: () => Promise.resolve([...store.keys()]),
    // Mirrors the real v3 surface. Mocking `multiRemove` here would have made
    // these tests pass against an API that does not exist.
    removeMany: (keys: string[]) => {
      for (const key of keys) store.delete(key);
      return Promise.resolve();
    },
  },
}));

const { clearSessionScopedStorage } = await import('../session-storage');

/**
 * Logout has to take the location trail with it.
 *
 * `signOut` cleared secure storage, the onboarding flag and the query cache —
 * but nothing touched `parkease.valet.fixQueue`, so up to 200 GPS fixes
 * (lat/lng, heading, accuracy, timestamp) stayed in plaintext AsyncStorage
 * after the valet logged out. On a shared or handed-back device that is a
 * readable record of where someone drove, belonging to a session that ended.
 *
 * Found by the security review lens. R-FE-10 is not the rule in play here —
 * the queue is correctly NOT in secure storage, because it is not a secret.
 * The miss is retention, not storage class.
 */
describe('clearSessionScopedStorage', () => {
  beforeEach(() => {
    store.clear();
  });

  it('removes the valet location queue', async () => {
    store.set('parkease.valet.fixQueue', '[{"lat":12.9,"lng":77.6}]');

    await clearSessionScopedStorage();

    expect(store.has('parkease.valet.fixQueue')).toBe(false);
  });

  it('removes every session-scoped key, not just the ones it knows by name', async () => {
    store.set('parkease.valet.fixQueue', '[]');
    store.set('parkease.valet.lastFixAt', '1700000000000');
    store.set('parkease.valet.fixFailure', '{"message":"denied"}');

    await clearSessionScopedStorage();

    expect([...store.keys()]).toEqual([]);
  });

  it('leaves keys that outlive a session alone', async () => {
    // Onboarding is a property of the device, not of whoever is signed in.
    store.set('hasOnboarded', 'true');
    store.set('parkease.valet.fixQueue', '[]');

    await clearSessionScopedStorage();

    expect(store.has('hasOnboarded')).toBe(true);
    expect(store.has('parkease.valet.fixQueue')).toBe(false);
  });

  it('is a no-op when there is nothing to clear', async () => {
    await expect(clearSessionScopedStorage()).resolves.toBeUndefined();
  });
});
