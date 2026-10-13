import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ComponentType, createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  'react-native',
  async () => (await import('../features/shared/__tests__/native-mock')).reactNative,
);
vi.mock(
  'react-native-reanimated',
  async () => (await import('../features/shared/__tests__/native-mock')).reanimated,
);
vi.mock(
  'react-native-safe-area-context',
  async () => (await import('../features/shared/__tests__/native-mock')).safeArea,
);
vi.mock(
  '@expo/vector-icons',
  async () => (await import('../features/shared/__tests__/native-mock')).vectorIcons,
);
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ default: 'MaterialCommunityIcons' }));
vi.mock(
  '@shopify/flash-list',
  async () => (await import('../features/shared/__tests__/native-mock')).flashList,
);
// The native modules a screen can reach, stubbed to the calls the screens make.
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: () => Promise.resolve({ status: 'denied', canAskAgain: true }),
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'denied' }),
  getCurrentPositionAsync: () => new Promise(() => undefined),
  ActivityType: { AutomotiveNavigation: 2, Other: 1 },
  watchPositionAsync: () => Promise.resolve({ remove: () => undefined }),
  hasStartedLocationUpdatesAsync: () => Promise.resolve(false),
  startLocationUpdatesAsync: () => Promise.resolve(),
  stopLocationUpdatesAsync: () => Promise.resolve(),
  Accuracy: { Balanced: 3, High: 4 },
}));
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: false }, vi.fn()],
}));
vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
  isTaskRegisteredAsync: () => Promise.resolve(false),
}));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: () => Promise.resolve({ status: 'undetermined' }),
  requestPermissionsAsync: () => Promise.resolve({ status: 'denied' }),
  setBadgeCountAsync: () => Promise.resolve(true),
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  addNotificationReceivedListener: () => ({ remove: () => undefined }),
  setNotificationHandler: vi.fn(),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}));
vi.mock('expo-device', () => ({ isDevice: false }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
    getAllKeys: () => Promise.resolve([]),
    multiRemove: () => Promise.resolve(),
  },
}));
vi.mock('react-native-pager-view', () => ({ default: 'PagerView' }));
vi.mock('react-native-webview', () => ({ WebView: 'WebView', default: 'WebView' }));
vi.mock('react-native-qrcode-svg', () => ({ default: 'QRCode' }));
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
  Redirect: 'Redirect',
  Link: 'Link',
  Stack: { Screen: 'StackScreen' },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: '0192f1c0-0000-7000-8000-000000000001', name: 'Priya S.' },
    roles: ['driver', 'owner', 'valet', 'washer'],
    activeRole: 'driver',
    signOut: vi.fn(),
  }),
}));

// Metro defines it; some Expo modules read it bare.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

/** What every GET answers in the current test: never, a failure, or the screen's empty body. */
const network = vi.hoisted(() => ({
  mode: 'loading' as 'loading' | 'error' | 'empty',
  empty: {} as Record<string, unknown>,
}));
vi.mock('@/lib/api', () => {
  const get = (url: string) => {
    if (network.mode === 'loading') return new Promise(() => undefined);
    if (network.mode === 'error') {
      return Promise.reject(
        Object.assign(new Error('Request failed with status code 503'), {
          isAxiosError: true,
          response: { status: 503, data: { error: { code: 'UNAVAILABLE', message: 'down' } } },
        }),
      );
    }
    const key = Object.keys(network.empty).find((prefix) => url.startsWith(prefix));
    return key === undefined
      ? Promise.reject(new Error(`no empty body for ${url}`))
      : Promise.resolve({ data: network.empty[key] });
  };
  return {
    api: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    newIntent: () => ({ idempotencyKey: '0192f1c0-0000-7000-8000-00000000abcd' }),
    registerSessionExpiredHandler: vi.fn(),
  };
});

const { mount, text } = await import('../features/shared/__tests__/render-native');
const { WasherPresenceProvider } = await import('../features/washer/presence-context');

const CURSOR_META = { limit: 20, hasMore: false, nextCursor: null };

interface Row {
  readonly route: string;
  readonly load: () => Promise<{ default: ComponentType }>;
  readonly empty?: Record<string, unknown>;
  /** Copy only the empty state shows; absent when the table does not drive this route empty. */
  readonly emptyCopy?: string;
  /** A provider the route sits under in its layout. */
  readonly wrap?: (screen: ReactElement) => ReactElement;
}

/**
 * §21.8 (S-157): every data screen in the table draws all three states from its own query —
 * a skeleton while nothing is known, an error with a way to retry, and its empty state — with the
 * network mocked at the API client, so the screen's real hooks, parsing and copy all run.
 */
const SCREENS: readonly Row[] = [
  {
    route: '(driver)/bookings',
    emptyCopy: 'Nothing booked yet',
    load: () => import('../../app/(driver)/bookings/index'),
    empty: { '/driver/bookings': { data: { items: [], meta: CURSOR_META } } },
  },
  {
    route: '(shared)/notifications',
    emptyCopy: 'All caught up',
    load: () => import('../../app/(shared)/notifications'),
    empty: { '/me/notifications': { data: [], meta: CURSOR_META } },
  },
  {
    route: '(washer)/offers',
    load: () => import('../../app/(washer)/offers'),
    // Gated on the profile and payout setup it also reads; its empty list is component-tested.
    wrap: (screen) => <WasherPresenceProvider>{screen}</WasherPresenceProvider>,
  },
  {
    route: '(valet)/active',
    emptyCopy: 'No active job',
    load: () => import('../../app/(valet)/active/index'),
    empty: { '/valet/jobs/active': { data: null } },
  },
  {
    route: '(washer)/active',
    emptyCopy: 'No active job',
    load: () => import('../../app/(washer)/active/index'),
    empty: { '/washer/jobs/active': { data: null } },
    wrap: (screen) => <WasherPresenceProvider>{screen}</WasherPresenceProvider>,
  },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function screenIn(row: Row, mode: 'loading' | 'error' | 'empty') {
  network.mode = mode;
  network.empty = row.empty ?? {};
  const { default: Screen } = await row.load();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  // One host root (a screen may render several siblings, and `text` reads one tree), mounted
  // once: a second mount would refetch a failed query and show it loading again.
  const screen = mount(
    createElement(
      'Screen',
      null,
      <QueryClientProvider client={client}>
        {row.wrap === undefined ? <Screen /> : row.wrap(<Screen />)}
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await settle();
    });
  }
  return text(screen.tree());
}

afterEach(() => {
  vi.clearAllMocks();
});

const ERROR_COPY = /couldn.?t load/i;

describe.each(SCREENS)('$route', (row) => {
  it('loading: shows neither an error nor its empty state', async () => {
    const shown = await screenIn(row, 'loading');
    expect(shown).not.toMatch(ERROR_COPY);
    if (row.emptyCopy !== undefined) expect(shown).not.toContain(row.emptyCopy);
  });

  it('error: says so and offers a retry', async () => {
    const shown = await screenIn(row, 'error');
    expect(shown).toMatch(ERROR_COPY);
    expect(shown).toMatch(/retry|try again/i);
  });

  it.runIf(row.emptyCopy !== undefined)('empty: shows its empty state, not an error', async () => {
    const shown = await screenIn(row, 'empty');
    expect(shown).toContain(row.emptyCopy);
    expect(shown).not.toMatch(ERROR_COPY);
  });
});
