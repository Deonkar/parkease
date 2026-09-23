import { colors } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render, style, text } from '../../shared/__tests__/render-native';
import { OnlineRail, type OnlineRailProps } from '../components/OnlineRail';

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Switch: 'Switch',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const rail = (props: Partial<OnlineRailProps> = {}) =>
  render(<OnlineRail isOnline busy={false} onToggle={() => undefined} {...props} />);

describe('the online rail', () => {
  it('is a real switch whose checked state and label both carry the state', () => {
    const online = byTestId(rail(), 'online-switch');
    const offline = byTestId(rail({ isOnline: false }), 'online-switch');

    expect(online?.props['accessibilityRole']).toBe('switch');
    expect(online?.props['accessibilityState']).toMatchObject({ checked: true });
    expect(String(online?.props['accessibilityLabel'])).toContain('online');
    expect(offline?.props['accessibilityState']).toMatchObject({ checked: false });
    expect(String(offline?.props['accessibilityLabel'])).toContain('offline');
  });

  it('says the state in words as well as colour (R-FE-12)', () => {
    expect(text(rail())).toContain('Online');
    expect(text(rail({ isOnline: false }))).toContain('Offline');
  });

  it('sits on the availability ground when online, and a muted one when not', () => {
    const online = byTestId(rail(), 'online-rail');
    const offline = byTestId(rail({ isOnline: false }), 'online-rail');

    expect(online && style(online)['backgroundColor']).toBe(colors.availableSoft);
    expect(offline && style(offline)['backgroundColor']).toBe(colors.surfaceTertiary);
  });

  it('says it is reconnecting when a heartbeat was lost', () => {
    expect(text(rail({ reconnecting: true }))).toContain('Reconnecting');
  });

  it('flips the switch through onToggle with the NEXT state', () => {
    const onToggle = vi.fn();
    const control = byTestId(rail({ isOnline: false, onToggle }), 'online-switch');

    (control?.props['onValueChange'] as (next: boolean) => void)(true);

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('cannot be flipped while a toggle is in flight', () => {
    const control = byTestId(rail({ busy: true }), 'online-switch');

    expect(control?.props['disabled']).toBe(true);
    expect(control?.props['accessibilityState']).toMatchObject({ disabled: true, busy: true });
  });

  it('says WHY it cannot be flipped, rather than only greying out', () => {
    const tree = rail({ isOnline: false, disabledReason: 'You can go online once approved' });

    expect(text(tree)).toContain('You can go online once approved');
    expect(byTestId(tree, 'online-switch')?.props['disabled']).toBe(true);
  });
});
