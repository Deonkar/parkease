import { colors } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, render, style, text } from '../../shared/__tests__/render-native';
import { OnlineRail, type OnlineRailProps } from '../components/OnlineRail';
import type { PresenceError } from '../presence';

const announced = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: announced },
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
  it('is a real switch whose checked state carries the state, under one fixed label (H8)', () => {
    const online = byTestId(rail(), 'online-switch');
    const offline = byTestId(rail({ isOnline: false }), 'online-switch');

    expect(online?.props['accessibilityRole']).toBe('switch');
    expect(online?.props['accessibilityState']).toMatchObject({ checked: true });
    expect(offline?.props['accessibilityState']).toMatchObject({ checked: false });
    // TalkBack reads the label AND the checked state: a label that also says
    // "online" makes it say the value twice.
    expect(online?.props['accessibilityLabel']).toBe(offline?.props['accessibilityLabel']);
    expect(String(online?.props['accessibilityLabel'])).not.toMatch(/online|offline/i);
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

/** H4: a failing heartbeat is announced when it appears, not only drawn. */
describe('the rail s announcements', () => {
  it('announces a problem once it appears', () => {
    announced.mockClear();
    rail({ problem: 'location_failed' });
    expect(announced).toHaveBeenCalledWith(expect.stringMatching(/Location not updating/));
  });

  it('announces nothing while all is well', () => {
    announced.mockClear();
    rail();
    expect(announced).not.toHaveBeenCalled();
  });
});

/**
 * M4 (walkthrough V4). The track is availability green because "available for
 * jobs" is exactly what green means here; the thumb is a token too, on the web
 * as well, where react-native-web otherwise draws its own teal.
 */
describe('the online switch colours', () => {
  it('draws the thumb and the track from the tokens, on and off', () => {
    const toggle = byTestId(rail(), 'online-switch');

    expect(toggle?.props['thumbColor']).toBe(colors.surface);
    expect(toggle?.props['activeThumbColor']).toBe(colors.surface);
    expect(toggle?.props['trackColor']).toEqual({
      false: colors.borderStrong,
      true: colors.available,
    });
  });
});
