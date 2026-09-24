import { toPaise } from '@parkease/contracts/primitives';
import type { WashJobView } from '@parkease/contracts/washer';
import { colors, touchTarget } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, nodes, render, style, text } from '../../shared/__tests__/render-native';
import { JobEndFooter, JobWonNotice } from '../components/JobMoments';
import { jobEndFor, showsJobWon } from '../job-moments';

const announced = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: announced },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView' },
  Easing: { bezier: () => 'bezier' },
  FadeIn: { duration: () => ({ easing: () => 'fade' }) },
  useReducedMotion: () => false,
}));

const job = (status: WashJobView['status']) =>
  ({ id: 'job-1', status }) as Pick<WashJobView, 'id' | 'status'>;

/** M9 (impeccable P3): the peak of the flow is winning a job. */
describe('the "It\'s yours" moment', () => {
  it('shows only on the job just won, and only until the partner sets off', () => {
    expect(showsJobWon('job-1', job('accepted'))).toBe(true);
    expect(showsJobWon('job-1', job('en_route'))).toBe(false);
    expect(showsJobWon('job-2', job('accepted'))).toBe(false);
    expect(showsJobWon(undefined, job('accepted'))).toBe(false);
  });

  it('says it in words, is announced, and is not a green "success"', () => {
    const tree = render(<JobWonNotice />);
    const root = byTestId(tree, 'job-won-notice');

    expect(text(tree)).toContain("It's yours");
    expect(announced).toHaveBeenCalledWith(expect.stringContaining("It's yours"));
    expect(root && style(root)['backgroundColor']).toBe(colors.primarySoft);
  });
});

/** M9: completed and cancelled are ends with a next step, never dead ends. */
describe('the end of a job', () => {
  it('is known only for a finished job', () => {
    expect(jobEndFor('completed')).toBe('completed');
    expect(jobEndFor('cancelled')).toBe('cancelled');
    for (const status of ['requested', 'offered', 'accepted', 'en_route', 'washing'] as const) {
      expect(jobEndFor(status)).toBeNull();
    }
  });

  const footer = (end: 'completed' | 'cancelled', earningsPaise: number | null = 31920) => {
    const onEarnings = vi.fn();
    const onOffers = vi.fn();
    const tree = render(
      <JobEndFooter
        end={end}
        earningsPaise={earningsPaise === null ? null : toPaise(earningsPaise)}
        onEarnings={onEarnings}
        onOffers={onOffers}
      />,
    );
    return { tree, onEarnings, onOffers };
  };

  it('says what a completed job earned, the server figure formatted, with a way to Earnings', () => {
    const { tree, onEarnings, onOffers } = footer('completed');

    expect(text(tree)).toContain('Job complete. Nice work.');
    expect(text(tree)).toContain('₹319.20');
    (byTestId(tree, 'job-end-earnings')?.props['onPress'] as () => void)();
    (byTestId(tree, 'job-end-offers')?.props['onPress'] as () => void)();
    expect(onEarnings).toHaveBeenCalledOnce();
    expect(onOffers).toHaveBeenCalledOnce();
  });

  it('drops the figure rather than guessing one when the server sent none', () => {
    expect(text(footer('completed', null).tree)).not.toContain('₹');
  });

  it('says what happens to the pay of a cancelled job, and offers the way back', () => {
    const { tree } = footer('cancelled');

    expect(text(tree)).toMatch(/pays nothing/);
    expect(byTestId(tree, 'job-end-offers')).toBeDefined();
    expect(byTestId(tree, 'job-end-earnings')).toBeUndefined();
  });

  it('gives every action the 48dp target', () => {
    const buttons = nodes(footer('completed').tree).filter(
      (node) => node.props['accessibilityRole'] === 'button',
    );

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(Number(style(button)['minHeight'])).toBeGreaterThanOrEqual(touchTarget);
    }
  });
});
