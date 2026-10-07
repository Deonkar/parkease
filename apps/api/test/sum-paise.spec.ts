import { sumPaise } from '@parkease/db/queries';
import { describe, expect, it } from 'vitest';

/** S-86: a ledger sum is exact or refused, never silently rounded. */
describe('sumPaise', () => {
  it('reads a numeric string, a number and NULL', () => {
    expect(sumPaise('616200')).toBe(616_200);
    expect(sumPaise(42)).toBe(42);
    expect(sumPaise(null)).toBe(0);
    expect(sumPaise('-500')).toBe(-500);
  });

  it('accepts the largest safe integer exactly', () => {
    expect(sumPaise(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses one paisa past it instead of rounding', () => {
    expect(() => sumPaise('9007199254740992')).toThrow(RangeError);
    expect(() => sumPaise('-9007199254740992')).toThrow(RangeError);
  });
});
