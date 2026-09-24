import { describe, expect, it } from 'vitest';

import { fontSize, layout, lineHeight, touchTarget } from '../src/index.js';

/** Section M of the task 14 fix wave: sizes that were literals become tokens. */
describe('layout', () => {
  it("is Material's 48dp minimum touch target, not HIG's 44", () => {
    expect(touchTarget).toBe(48);
  });

  it('gives a tab label its own line box inside the bar', () => {
    // The tab item's 5px padding top and bottom, a 28px icon box, then the label.
    const label = fontSize.xs * lineHeight.normal;
    expect(5 + 28 + label + 5).toBeLessThanOrEqual(layout.tabBarHeight - 2 * 4);
  });

  it('caps reading width well above a phone and below a tablet landscape', () => {
    expect(layout.contentMaxWidth).toBeGreaterThan(412);
    expect(layout.contentMaxWidth).toBeLessThan(1024);
  });

  it('orders the skeleton steps smallest to largest', () => {
    const steps = Object.values(layout.skeleton);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(layout.skeleton.line).toBe(touchTarget);
  });
});
