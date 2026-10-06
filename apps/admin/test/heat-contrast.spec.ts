import { describe, expect, it } from 'vitest';

import { HEAT_STEPS, geohashBounds, inkFor } from '../src/features/surge/HeatMap';

const channel = (hex: string, i: number): number => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('heat map', () => {
  it('every legend chip clears WCAG AA for its label', () => {
    for (const [, fill] of HEAT_STEPS)
      expect(contrast(inkFor(fill), fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('decodes a geohash to the cell that contains its point, and refuses a non-geohash', () => {
    // The reference value from the geohash spec: u4pruydqqvj is (57.64911, 10.40744).
    const [w, s, e, n] = geohashBounds('u4pruydqqvj');
    expect(w).toBeLessThanOrEqual(10.40744);
    expect(e).toBeGreaterThanOrEqual(10.40744);
    expect(s).toBeLessThanOrEqual(57.64911);
    expect(n).toBeGreaterThanOrEqual(57.64911);
    expect(e - w).toBeLessThan(0.0005);
    expect(() => geohashBounds('tdr1ua')).toThrow();
  });
});
