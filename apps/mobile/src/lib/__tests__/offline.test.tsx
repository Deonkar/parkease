import { MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn(() => () => undefined) },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
vi.mock(
  'react-native',
  async () => (await import('../../features/shared/__tests__/native-mock')).reactNative,
);
vi.mock(
  'react-native-safe-area-context',
  async () => (await import('../../features/shared/__tests__/native-mock')).safeArea,
);
vi.mock(
  '@expo/vector-icons',
  async () => (await import('../../features/shared/__tests__/native-mock')).vectorIcons,
);
vi.mock('@/features/shared/api/failure', () => ({ classifyFailure: () => 'unreachable' }));

const { isOnlineState, shouldPersistQuery } = await import('../offline');
const { queryDefaults } = await import('../query');
const { OfflineBanner } = await import('../../features/shared/components/OfflineBanner');
const { render, text } = await import('../../features/shared/__tests__/render-native');

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('the online signal (S-150)', () => {
  it('is online unless the OS says disconnected or unable to reach out', () => {
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});

describe('what is saved for an offline cold start', () => {
  const query = (queryKey: unknown[], status: 'success' | 'error' = 'success') =>
    ({ queryKey, state: { status } }) as never;

  it('keeps bookings, earnings and notifications that loaded', () => {
    expect(shouldPersistQuery(query(['driver', 'bookings', 'list', 'upcoming']))).toBe(true);
    expect(shouldPersistQuery(query(['owner', 'earnings', 'month']))).toBe(true);
    expect(shouldPersistQuery(query(['notifications', 'feed']))).toBe(true);
  });

  it('keeps nothing that failed, and nothing outside those families', () => {
    expect(shouldPersistQuery(query(['driver', 'bookings', 'list', 'past'], 'error'))).toBe(false);
    expect(shouldPersistQuery(query(['driver', 'quote', {}]))).toBe(false);
    expect(shouldPersistQuery(query(['washer', 'active']))).toBe(false);
  });
});

describe('an intent made offline', () => {
  const client = () => new QueryClient({ defaultOptions: queryDefaults });

  const intend = (c: QueryClient, fn: (vars: { key: string }) => Promise<string>, key: string) => {
    const observer = new MutationObserver(c, { mutationFn: fn });
    const settled = observer.mutate({ key }).catch((error: unknown) => error);
    return { observer, settled };
  };

  it('waits, then replays in the order it was made, each once, with the key it was given', async () => {
    const c = client();
    const sent: string[] = [];
    const fn = vi.fn(({ key }: { key: string }) => {
      sent.push(key);
      return Promise.resolve(key);
    });
    onlineManager.setOnline(false);

    intend(c, fn, 'intent-1');
    intend(c, fn, 'intent-2');
    await settle();
    expect(fn).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    await settle();
    // A second resume (the persist restore, a reconnect flap) sends nothing twice.
    await c.resumePausedMutations();
    await settle();

    expect(sent).toEqual(['intent-1', 'intent-2']);
  });

  it('a replay that fails reaches the screen as an error, not silence', async () => {
    const c = client();
    onlineManager.setOnline(false);
    const { observer } = intend(c, () => Promise.reject(new Error('slot taken')), 'intent-3');

    onlineManager.setOnline(true);
    await settle();

    expect(observer.getCurrentResult().status).toBe('error');
    expect(observer.getCurrentResult().error?.message).toBe('slot taken');
  });
});

describe('the offline banner', () => {
  it('shows only while offline, and says what still works', () => {
    expect(render(<OfflineBanner />)).toBeNull();

    onlineManager.setOnline(false);
    const shown = text(render(<OfflineBanner />));
    expect(shown).toContain("You're offline");
    expect(shown).toContain('will send when');
  });
});
