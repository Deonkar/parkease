import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('@parkease/ui-native', () => ({ Button: 'Button', ListSkeleton: 'ListSkeleton' }));
vi.mock('../../shared/components/ReportSheet', () => ({ ReportSheet: 'ReportSheet' }));

const review = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  bookingId: '0192f1c0-0000-7000-8000-0000000000b0',
  targetType: 'space',
  targetId: 's1',
  rating: 4,
  comment: `${name} says hi`,
  reviewerName: name,
  createdAt: new Date().toISOString(),
  ownerResponse: null,
  ownerRespondedAt: null,
  isReported: false,
  ...over,
});

const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../shared/reviews/hooks', () => ({
  useOwnerReviewSummary: () => ({
    data: [
      {
        spaceId: 's1',
        spaceTitle: 'Basement',
        ratingAvgBp: 42_000,
        ratingCount: 3,
        distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
        reportedCount: 1,
      },
    ],
  }),
  useOwnerReviews: () => ({
    isPending: false,
    isError: false,
    hasNextPage: false,
    data: {
      pages: [
        {
          data: [
            review('r1', 'Answered A.', {
              ownerResponse: 'Thanks!',
              ownerRespondedAt: new Date().toISOString(),
            }),
            review('r2', 'Spam S.', { isReported: true, rating: 1 }),
            review('r3', 'Open O.'),
          ],
        },
      ],
    },
  }),
  useRespondToReview: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}));

const { mount, nodes, render, text } = await import('../../shared/__tests__/render-native');
const { OwnerReviewsSection } = await import('../components/OwnerReviewsSection');

describe('OwnerReviewsSection', () => {
  it('leads with what needs a reply, and says what is reported', () => {
    const rendered = text(render(<OwnerReviewsSection spaceId="s1" />));
    expect(rendered).toContain('4.2');
    expect(rendered).toContain('1 reported');
    expect(rendered).toContain('Reported. Under review by ParkEase.');
    expect(rendered.indexOf('Needs a reply')).toBeLessThan(rendered.indexOf('Answered A.'));
    expect(rendered.indexOf('Open O.')).toBeLessThan(rendered.indexOf('Answered A.'));
    // Nobody is asked to answer a review that is sitting in the moderation queue.
    expect(rendered.match(/Needs a reply/g)).toHaveLength(1);
  });

  it('opens an inline reply and posts the trimmed text', () => {
    const view = mount(<OwnerReviewsSection spaceId="s1" />);
    const respond = nodes(view.tree()).find(
      (n) => n.props['accessibilityLabel'] === 'Respond to Open O.',
    );
    act(() => {
      (respond?.props['onPress'] as () => void)();
    });

    const input = nodes(view.tree()).find((n) => n.type === 'TextInput');
    act(() => {
      (input?.props['onChangeText'] as (t: string) => void)('  Sorry about the gate.  ');
    });
    const post = nodes(view.tree()).find(
      (n) => n.type === 'Button' && n.props['label'] === 'Post reply',
    );
    act(() => {
      (post?.props['onPress'] as () => void)();
    });

    expect(state.mutate).toHaveBeenCalledWith(
      { reviewId: 'r3', response: 'Sorry about the gate.' },
      expect.anything(),
    );
  });
});
