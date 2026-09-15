import { describe, expect, it } from 'vitest';

import { allocateProportionally } from '../src/money/allocate.js';
import { toPaise } from '../src/primitives/paise.js';

const sum = (parts: readonly number[]): number => parts.reduce((total, part) => total + part, 0);

describe('allocateProportionally', () => {
  it('splits the canonical 50% refund across the three original credits', () => {
    // 4851 against [owner 5100, fee 3900, gst 702] — the worked example in
    // task 9 §9.9. Three independent mulRate calls drift by a paisa here; this
    // is why the split is allocated rather than computed leg by leg.
    const parts = allocateProportionally(toPaise(4851), [
      toPaise(5100),
      toPaise(3900),
      toPaise(702),
    ]);

    expect(parts).toEqual([2550, 1950, 351]);
    expect(sum(parts)).toBe(4851);
  });

  it('never loses or invents a paisa, over ten thousand random splits', () => {
    // The property that matters. A one-paisa drift is an unbalanced posting,
    // and an unbalanced posting fails the whole transaction it rides in.
    let seed = 0x9e3779b9;
    const nextInt = (bound: number): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed % bound;
    };

    for (let run = 0; run < 10_000; run += 1) {
      const total = toPaise(nextInt(10_000_000));
      const weights = Array.from({ length: 1 + nextInt(6) }, () => toPaise(nextInt(500_000)));
      const weightSum = sum(weights);

      const parts = allocateProportionally(total, weights);

      expect(parts).toHaveLength(weights.length);
      expect(sum(parts)).toBe(weightSum === 0 ? 0 : total);
      expect(parts.every((part) => Number.isInteger(part) && part >= 0)).toBe(true);
    }
  });

  it('returns zeros for all-zero weights rather than dividing by zero', () => {
    expect(allocateProportionally(toPaise(9702), [toPaise(0), toPaise(0)])).toEqual([0, 0]);
  });

  it('gives the whole total to a single weight', () => {
    expect(allocateProportionally(toPaise(9702), [toPaise(7)])).toEqual([9702]);
  });

  it('allocates nothing when the total is zero', () => {
    expect(allocateProportionally(toPaise(0), [toPaise(5100), toPaise(3900)])).toEqual([0, 0]);
  });

  it('breaks a remainder tie by index, so the same input always gives the same output', () => {
    // 10 across three equal weights: every part has the same fractional
    // remainder, so the one spare paisa must go somewhere deterministic.
    const first = allocateProportionally(toPaise(10), [toPaise(1), toPaise(1), toPaise(1)]);

    expect(first).toEqual([4, 3, 3]);
    expect(allocateProportionally(toPaise(10), [toPaise(1), toPaise(1), toPaise(1)])).toEqual(
      first,
    );
  });

  it('gives the spare paisa to the largest remainder, not the largest weight', () => {
    // Exact shares are 3.75 and 5.25. The floors are 3 and 5; the odd paisa
    // belongs to the 0.75 remainder, which sits on the *smaller* weight.
    expect(allocateProportionally(toPaise(9), [toPaise(5), toPaise(7)])).toEqual([4, 5]);
  });

  it('skips the zero-weight legs when other legs carry weight', () => {
    expect(allocateProportionally(toPaise(100), [toPaise(1), toPaise(0), toPaise(1)])).toEqual([
      50, 0, 50,
    ]);
  });

  it('refuses to allocate across no legs at all', () => {
    expect(() => allocateProportionally(toPaise(9702), [])).toThrow(RangeError);
  });
});
