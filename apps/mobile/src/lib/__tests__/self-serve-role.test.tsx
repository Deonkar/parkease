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
vi.mock('expo-router', () => ({
  Redirect: 'Redirect',
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('@/features/shared/notifications/NotificationsRow', () => ({
  NotificationsRow: () => null,
}));

const auth = vi.hoisted(() => ({
  current: {
    status: 'authenticated' as const,
    roles: ['driver'] as readonly string[],
    activeRole: 'driver' as string | null,
    signOut: vi.fn(() => Promise.resolve()),
    switchRole: vi.fn(() => Promise.resolve()),
    addRole: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));

const { act } = await import('react');
const { mount, nodes, text } = await import('../../features/shared/__tests__/render-native');
const { default: ChooseRoleScreen } = await import('../../../app/(auth)/choose-role');
const { default: DriverProfileScreen } = await import('../../../app/(driver)/profile');

const press = async (tree: ReturnType<ReturnType<typeof mount>['tree']>, label: RegExp) => {
  const target = nodes(tree).find(
    (node) =>
      node.type === 'Pressable' && label.test(String(node.props['accessibilityLabel'] ?? '')),
  );
  if (target === undefined) throw new Error(`no pressable labelled ${String(label)}`);
  await act(async () => {
    (target.props['onPress'] as () => void)();
    await Promise.resolve();
  });
};

/** S-149: a role the account does not hold is taken on, never switched to. */
describe('self-serve roles in the app', () => {
  it('choose-role takes on owner for a driver, and switches to driver', async () => {
    const view = mount(<ChooseRoleScreen />);

    await press(view.tree(), /parking space/i);
    expect(auth.current.addRole).toHaveBeenCalledWith('owner');
    expect(auth.current.switchRole).not.toHaveBeenCalled();

    await press(view.tree(), /looking for parking/i);
    expect(auth.current.switchRole).toHaveBeenCalledWith('driver');
  });

  it('the driver profile offers only the roles not yet held', () => {
    auth.current.roles = ['driver', 'valet'];
    const shown = text(mount(<DriverProfileScreen />).tree());

    expect(shown).toContain('List your parking space');
    expect(shown).toContain('Offer car washes');
    expect(shown).not.toContain('Register as a valet');
  });
});
