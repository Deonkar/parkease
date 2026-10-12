import { describe, expect, it } from 'vitest';

import { radius } from '../src/index.js';

/** S-118: the Wayfinder direction fixes "10px radius, 8px chips". */
describe('radius', () => {
  it('gives cards 10px and chips 8px', () => {
    expect(radius.md).toBe(10);
    expect(radius.chip).toBe(8);
  });

  it('sits the chip between an input and a card', () => {
    expect(radius.chip).toBeGreaterThan(radius.sm);
    expect(radius.chip).toBeLessThan(radius.md);
  });
});
