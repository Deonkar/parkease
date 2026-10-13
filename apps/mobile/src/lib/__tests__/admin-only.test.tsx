import { describe, expect, it, vi } from 'vitest';

vi.mock(
  'react-native',
  async () => (await import('../../features/shared/__tests__/native-mock')).reactNative,
);
vi.mock(
  '@expo/vector-icons',
  async () => (await import('../../features/shared/__tests__/native-mock')).vectorIcons,
);
vi.mock(
  'react-native-safe-area-context',
  async () => (await import('../../features/shared/__tests__/native-mock')).safeArea,
);
vi.mock('expo-router', () => ({ Redirect: 'Redirect', router: { replace: vi.fn() } }));

const auth = vi.hoisted(() => ({
  current: {
    status: 'authenticated' as const,
    roles: ['admin'] as readonly string[],
    activeRole: null as string | null,
    signOut: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/features/shared/hooks/useHasOnboarded', () => ({ useHasOnboarded: () => true }));

const { mount, nodes, render, text } = await import(
  '../../features/shared/__tests__/render-native'
);
const { ADMIN_ONLY_ROUTE, isAdminOnly, landingRouteForSession } = await import('../landing-route');
const { default: AdminOnlyScreen } = await import('../../../app/(auth)/admin-only');
const { default: ChooseRoleScreen } = await import('../../../app/(auth)/choose-role');
const { default: Splash } = await import('../../../app/index');

const redirectOf = (tree: ReturnType<typeof render>) =>
  nodes(tree).find((node) => node.type === 'Redirect')?.props['href'] as unknown;

/** S-54: an admin-only account never lands where every choice fails. */
describe('an admin-only account', () => {
  it('is told apart from a new account with no roles yet, and from a mixed one', () => {
    expect(isAdminOnly(['admin'])).toBe(true);
    expect(isAdminOnly([])).toBe(false);
    expect(isAdminOnly(['admin', 'driver'])).toBe(false);
  });

  it('lands on the admin-only screen whatever its active role says', () => {
    expect(landingRouteForSession(['admin'], null)).toBe(ADMIN_ONLY_ROUTE);
    expect(landingRouteForSession(['admin'], 'admin')).toBe(ADMIN_ONLY_ROUTE);
    expect(landingRouteForSession(['admin', 'driver'], 'driver')).toBe('/(driver)');
  });

  it('is redirected there by the splash on sign-in', () => {
    expect(redirectOf(render(<Splash />))).toBe(ADMIN_ONLY_ROUTE);
  });

  it('cannot reach choose-role: it redirects to the admin-only screen', () => {
    const tree = render(<ChooseRoleScreen />);
    expect(redirectOf(tree)).toBe(ADMIN_ONLY_ROUTE);
    expect(text(tree)).not.toContain('How will you use ParkEase?');
  });

  it('sees where to go instead, and can sign out', () => {
    const view = mount(<AdminOnlyScreen />);
    expect(text(view.tree())).toContain('Use the admin panel');
    const signOut = nodes(view.tree()).find(
      (node) => node.type === 'Pressable' && node.props['accessibilityLabel'] === 'Sign out',
    );
    expect(signOut).toBeDefined();
    (signOut?.props['onPress'] as () => void)();
    expect(auth.current.signOut).toHaveBeenCalledTimes(1);
  });

  it('a driver still sees choose-role', () => {
    auth.current = { ...auth.current, roles: ['driver'], activeRole: 'driver' };
    expect(text(render(<ChooseRoleScreen />))).toContain('How will you use ParkEase?');
  });
});
