import { publicReviewViewSchema } from '@parkease/contracts/driver';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));

const { mount, nodes, render, style, text } = await import('./render-native');
const { StarInput } = await import('../components/StarInput');
const { StarRating } = await import('../components/StarRating');
const { ReviewsSummary } = await import('../components/ReviewsSummary');
const { ReviewItem } = await import('../components/ReviewItem');

const REVIEW = publicReviewViewSchema.parse({
  id: '0192f1c0-0000-7000-8000-000000001000',
  bookingId: '0192f1c0-0000-7000-8000-0000000000b0',
  targetType: 'space',
  targetId: '0192f1b3-0000-7000-8000-000000000001',
  rating: 4,
  comment: 'Easy to find.',
  reviewerName: 'Ravi K.',
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  ownerResponse: 'Thanks Ravi.',
  ownerRespondedAt: new Date().toISOString(),
});

describe('StarInput', () => {
  it('is five 48dp buttons, each saying what it sets', () => {
    const tree = render(
      <StarInput value={null} onChange={() => undefined} label="Basement Parking" />,
    );
    const stars = nodes(tree).filter((n) => n.type === 'Pressable');
    expect(stars).toHaveLength(5);
    expect(stars.map((s) => String(s.props['accessibilityLabel']))).toEqual([
      'Rate Basement Parking 1 out of 5',
      'Rate Basement Parking 2 out of 5',
      'Rate Basement Parking 3 out of 5',
      'Rate Basement Parking 4 out of 5',
      'Rate Basement Parking 5 out of 5',
    ]);
    for (const star of stars) {
      expect(style(star)['minWidth']).toBeGreaterThanOrEqual(48);
      expect(style(star)['minHeight']).toBeGreaterThanOrEqual(48);
    }
  });

  it('reports the tapped value and marks it selected', () => {
    const onChange = vi.fn();
    const view = mount(<StarInput value={3} onChange={onChange} label="Valet" />);
    const stars = nodes(view.tree()).filter((n) => n.type === 'Pressable');
    act(() => {
      (stars[3]?.props['onPress'] as () => void)();
    });
    expect(onChange).toHaveBeenCalledWith(4);
    expect(stars[2]?.props['accessibilityState']).toEqual({ selected: true });
    expect(stars[3]?.props['accessibilityState']).toEqual({ selected: false });
  });
});

describe('StarRating', () => {
  it('is one labelled image, not five glyphs', () => {
    const tree = render(<StarRating stars="4.2" reviewCount={18} />);
    expect(tree?.props['accessibilityLabel']).toBe('4.2 out of 5 stars, 18 reviews');
    expect(tree?.props['accessibilityRole']).toBe('image');
  });
});

describe('ReviewsSummary', () => {
  const summary = {
    ratingAvgBp: null,
    ratingCount: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  it('says "New" for an unreviewed space and never shows a zero', () => {
    const rendered = text(
      render(<ReviewsSummary badge={{ kind: 'new', label: 'New' }} summary={summary} />),
    );
    expect(rendered).toContain('New');
    expect(rendered).toContain('No reviews yet');
    expect(rendered).not.toMatch(/0\.0|★ 0/);
  });

  it('names a low rating in words as well as colour', () => {
    const rendered = text(
      render(
        <ReviewsSummary
          badge={{ kind: 'low_rated', label: 'Mixed reviews', stars: '2.7', reviewCount: 4 }}
          summary={{
            ...summary,
            ratingAvgBp: 27_000,
            ratingCount: 4,
            distribution: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 0 },
          }}
        />,
      ),
    );
    expect(rendered).toContain('Mixed reviews');
    expect(rendered).toContain('Recent reviews count more');
  });
});

describe('ReviewItem', () => {
  it('shows the owner reply and offers Report only when it can be used', () => {
    expect(text(render(<ReviewItem review={REVIEW} />))).not.toContain('Report');
    const withReport = text(render(<ReviewItem review={REVIEW} onReport={() => undefined} />));
    expect(withReport).toContain('Report');
    expect(withReport).toContain('Thanks Ravi.');
    expect(withReport).toContain('2 days ago');
  });
});
