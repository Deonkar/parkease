import { describe, expect, it } from 'vitest';

import {
  durationSuffix,
  formatDistance,
  formatRatingLabel,
  markerPriceLabel,
  markerTone,
  spaceAccessibilityLabel,
} from '../space-display';

import { makeItem } from './fixtures';

describe('formatDistance', () => {
  it('shows metres below a kilometre', () => {
    expect(formatDistance(450)).toBe('450 m');
  });

  it('shows one decimal kilometre at and above a kilometre', () => {
    expect(formatDistance(1100)).toBe('1.1 km');
  });
});

describe('formatRatingLabel', () => {
  it('renders "New" for a space that was never reviewed', () => {
    expect(formatRatingLabel(null, 0)).toBe('New');
  });

  it('renders the score and review count once reviewed', () => {
    expect(formatRatingLabel(4.2, 18)).toBe('4.2 (18)');
  });
});

describe('markerTone', () => {
  it('is car when a car slot is free', () => {
    expect(markerTone(makeItem())).toBe('car');
  });

  it('is twoWheeler when only two-wheeler slots are free', () => {
    expect(markerTone(makeItem({ availableSlots: { car: 0, twoWheeler: 3 } }))).toBe('twoWheeler');
  });

  it('is closed when the space is not open, whatever is free', () => {
    expect(markerTone(makeItem({ isOpenNow: false }))).toBe('closed');
  });
});

describe('markerPriceLabel', () => {
  it('labels every marker with the effective price, so colour is never the only signal', () => {
    expect(markerPriceLabel(makeItem())).toBe('₹45');
  });
});

describe('durationSuffix', () => {
  it('maps each duration to its short and spoken form', () => {
    expect(durationSuffix('hourly')).toEqual({ short: '/hr', spoken: 'per hour' });
    expect(durationSuffix('monthly')).toEqual({ short: '/month', spoken: 'per month' });
  });
});

describe('spaceAccessibilityLabel', () => {
  it('names the space, distance, price and free slots', () => {
    expect(spaceAccessibilityLabel(makeItem(), 'hourly')).toBe(
      'Basement Parking, 450 metres, ₹45 per hour, 1 car slot free, 3 two-wheeler slots free',
    );
  });

  it('pluralises slot counts', () => {
    const label = spaceAccessibilityLabel(
      makeItem({ availableSlots: { car: 2, twoWheeler: 1 } }),
      'hourly',
    );
    expect(label).toContain('2 car slots free');
    expect(label).toContain('1 two-wheeler slot free');
  });

  it('says when the space is closed', () => {
    expect(spaceAccessibilityLabel(makeItem({ isOpenNow: false }), 'hourly')).toContain(
      'closed now',
    );
  });

  it('speaks kilometres for far results', () => {
    expect(spaceAccessibilityLabel(makeItem({ distanceM: 1100 }), 'hourly')).toContain(
      '1.1 kilometres',
    );
  });
});
