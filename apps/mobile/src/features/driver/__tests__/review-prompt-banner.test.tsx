import type { PendingReview } from '@parkease/contracts/driver';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));

const pendingState = vi.hoisted(() => ({
  value: { data: undefined as PendingReview[] | undefined, isError: false },
}));
vi.mock('../../shared/reviews/hooks', () => ({ usePendingReviews: () => pendingState.value }));
vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

const { render, text } = await import('../../shared/__tests__/render-native');
const { ReviewPromptBanner } = await import('../components/ReviewPromptBanner');
const { warn } = await import('@/lib/log');

const PENDING = {
  bookingId: '0192f1c0-0000-7000-8000-0000000000b0',
  spaceTitle: 'Basement Parking',
  completedAt: '2026-10-04T10:00:00.000Z',
  reviewableUntil: '2026-10-11T10:00:00.000Z',
  targets: [
    { targetType: 'space', targetId: 's1', name: 'Basement Parking', reviewed: false },
    { targetType: 'valet', targetId: 'v1', name: 'Ravi K.', reviewed: false },
    { targetType: 'washer', targetId: 'w1', name: 'A', reviewed: true },
  ],
} as unknown as PendingReview;

describe('ReviewPromptBanner', () => {
  it('asks about the stay and says what is left to rate', () => {
    pendingState.value = { data: [PENDING], isError: false };
    const rendered = text(render(<ReviewPromptBanner onOpen={() => undefined} />));
    expect(rendered).toContain('Rate your stay');
    expect(rendered).toContain('Basement Parking · valet');
    expect(rendered).not.toContain('wash');
  });

  it('renders nothing when there is nothing to rate', () => {
    pendingState.value = { data: [], isError: false };
    expect(render(<ReviewPromptBanner onOpen={() => undefined} />)).toBeNull();
  });

  it('renders nothing on an error, and says so in the log rather than blanking a screen', () => {
    pendingState.value = { data: undefined, isError: true };
    expect(render(<ReviewPromptBanner onOpen={() => undefined} />)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
