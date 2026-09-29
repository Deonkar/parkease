import type { RouteOnboardingView } from '@parkease/contracts/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));

const query = vi.hoisted(() => ({
  current: { data: undefined, isError: false } as {
    data: RouteOnboardingView | null | undefined;
    isError: boolean;
  },
}));
vi.mock('../hooks', () => ({ useRouteOnboarding: () => query.current }));

const { render, text } = await import('../../__tests__/render-native');
const { PayoutSetupBanner } = await import('../entry');

const view = (status: RouteOnboardingView['status']): RouteOnboardingView => ({
  status,
  legalName: 'Priya Sharma',
  bankLast4: '6789',
  ifscPrefix: 'HDFC',
  requirements: [],
});

const shown = () =>
  text(render(<PayoutSetupBanner payee="owner" href="/(owner)/earnings/payouts" />));

/**
 * The banner is the only place an owner learns why drivers cannot see their spaces, or a
 * washer why no offers arrive (task 16b gating), so when it shows is behaviour, not styling.
 */
describe('PayoutSetupBanner', () => {
  beforeEach(() => {
    query.current = { data: undefined, isError: false };
  });

  it('stays out of the way while loading', () => {
    expect(shown()).toBe('');
  });

  it('says spaces are hidden before any setup', () => {
    query.current = { data: null, isError: false };
    expect(shown()).toContain('Your spaces are hidden from drivers');
  });

  it.each(['under_review', 'activated'] as const)('is gone once %s', (status) => {
    query.current = { data: view(status), isError: false };
    expect(shown()).toBe('');
  });

  it('asks for a change on needs_clarification', () => {
    query.current = { data: view('needs_clarification'), isError: false };
    expect(shown()).toContain('Razorpay needs a change');
  });

  it('still shows on a failed read, rather than leaving hidden spaces unexplained', () => {
    query.current = { data: undefined, isError: true };
    expect(shown()).toContain("Couldn't check your payout setup");
  });
});
