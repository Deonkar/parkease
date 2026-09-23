import { describe, expect, it } from 'vitest';

import { opacity } from '../src/index.js';

/**
 * Opacity is a token like any other (T7 fix round, minor 8): a literal `0.45`
 * in one component and `0.5` in the next is two screens disagreeing about
 * what "dimmed" means.
 */
describe('opacity', () => {
  it('keeps every step strictly between invisible and opaque', () => {
    for (const value of Object.values(opacity)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('dims further than it mutes', () => {
    expect(opacity.dimmed).toBeLessThan(opacity.muted);
  });
});
