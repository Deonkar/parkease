import { colors } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render, style, text } from '../../shared/__tests__/render-native';
import { OnlineRail, type OnlineRailProps } from '../components/OnlineRail';
import type { PresenceError } from '../presence';

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

  it('says it is reconnecting when a heartbeat did not reach the server', () => {
    expect(text(rail({ problem: 'unreachable' }))).toContain('Reconnecting');
  });

  it('names each failure for what it is, not all of them "Reconnecting"', () => {
    const reasons: PresenceError[] = [
      'unreachable',
      'location_failed',
      'permission_denied',
      'not_verified',
      'not_registered',
    ];
    const titles = reasons.map((problem) => text(rail({ problem })));

    expect(new Set(titles).size).toBe(reasons.length);
    expect(titles.filter((t) => t.includes('Reconnecting'))).toHaveLength(1);
    expect(text(rail({ problem: 'permission_denied' }))).toContain('permission');
    expect(text(rail({ problem: 'not_verified' }))).toContain('verif');
  });

  it('says why an automatic resume did not put the partner back online', () => {
    const tree = rail({ isOnline: false, problem: 'permission_denied' });

    expect(text(tree)).toContain('Offline');
    expect(text(tree)).toContain('location');
  });

  it('shows words, not only a frozen switch, while a toggle is in flight', () => {
    expect(text(rail({ isOnline: false, busy: true }))).toContain('Going online…');
    expect(text(rail({ isOnline: true, busy: true }))).toContain('Going offline…');
  });

  it('gives TalkBack the reason a disabled switch cannot be used', () => {
    const reason = 'You can go online once approved';
    const control = byTestId(rail({ isOnline: false, disabledReason: reason }), 'online-switch');

    expect(control?.props['accessibilityHint']).toBe(reason);
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

/** G7: a refused heartbeat has its own words, not "Reconnecting…". */
describe('a refused heartbeat', () => {
  it('says the update was refused while online, never that it is reconnecting', () => {
    const all = text(rail({ problem: 'refused' }));
    expect(all).toMatch(/refused/i);
    expect(all).not.toMatch(/Reconnecting/);
  });

  it('says why a resume was refused while offline', () => {
    const all = text(rail({ isOnline: false, problem: 'refused' }));
    expect(all).toMatch(/refused|didn't accept/i);
  });
});
