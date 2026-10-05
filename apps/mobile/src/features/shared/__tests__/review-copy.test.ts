import { describe, expect, it } from 'vitest';

import { reviewedAgo, starsLabel } from '../reviews/review-copy';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('reviewedAgo', () => {
  it.each([
    [0, 'Today'],
    [1, 'Yesterday'],
    [2, '2 days ago'],
    [6, '6 days ago'],
    [7, '1 week ago'],
    [21, '3 weeks ago'],
  ])('%i days → %s', (days, copy) => {
    expect(reviewedAgo(ago(days), NOW)).toBe(copy);
  });

  it('switches to a date after eight weeks', () => {
    expect(reviewedAgo(ago(80), NOW)).toMatch(/^\d{1,2} [A-Z][a-z]{2}/);
  });
});

describe('starsLabel', () => {
  it('reads as a phrase a screen reader can say', () => {
    expect(starsLabel('4.2', 18)).toBe('4.2 out of 5 stars, 18 reviews');
    expect(starsLabel('5.0', 1)).toBe('5.0 out of 5 stars, 1 review');
    expect(starsLabel(3)).toBe('3 out of 5 stars');
  });
});
