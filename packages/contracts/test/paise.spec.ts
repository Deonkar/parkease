import { describe, expect, it } from 'vitest';

import {
  addPaise,
  mulRate,
  paiseSchema,
  subPaise,
  toPaise,
  toRate,
} from '../src/primitives/paise.js';

describe('toPaise', () => {
  it('accepts a non-negative integer', () => {
    expect(toPaise(9702)).toBe(9702);
    expect(toPaise(0)).toBe(0);
  });

  it('throws on a fractional value', () => {
    expect(() => toPaise(97.02)).toThrow();
  });

  it('throws on a negative value', () => {
    expect(() => toPaise(-1)).toThrow();
  });

  it('paiseSchema.parse returns a value assignable to Paise', () => {
    const p = paiseSchema.parse(9702);
    expect(p).toBe(9702);
  });
});

describe('toRate', () => {
  it('accepts valid rates', () => {
    expect(toRate(0.15)).toBe(0.15);
    expect(toRate(0)).toBe(0);
    expect(toRate(1)).toBe(1);
    expect(toRate(3)).toBe(3);
  });

  it('rejects rates > 10', () => {
    expect(() => toRate(10.01)).toThrow();
  });

  it('rejects negative rates', () => {
    expect(() => toRate(-0.01)).toThrow();
  });
});

describe('mulRate', () => {
  it('mulRate(1, 0.15) → 0 (0.15 paisa rounds down)', () => {
    expect(mulRate(toPaise(1), toRate(0.15))).toBe(0);
  });

  it('mulRate(10, 0.15) → 2 (1.5 paisa rounds half-up)', () => {
    expect(mulRate(toPaise(10), toRate(0.15))).toBe(2);
  });

  it('mulRate(30, 0.15) → 5 (4.5 rounds up)', () => {
    expect(mulRate(toPaise(30), toRate(0.15))).toBe(5);
  });

  it('mulRate(3, 0.5) → 2 (1.5 rounds up)', () => {
    expect(mulRate(toPaise(3), toRate(0.5))).toBe(2);
  });

  it('mulRate(6000, 0.15) → 900 exactly, no float artefact', () => {
    expect(mulRate(toPaise(6000), toRate(0.15))).toBe(900);
  });

  it('mulRate(0, anyRate) → 0', () => {
    expect(mulRate(toPaise(0), toRate(0.15))).toBe(0);
    expect(mulRate(toPaise(0), toRate(0.99))).toBe(0);
  });
});

describe('addPaise', () => {
  it('sums multiple Paise values', () => {
    expect(addPaise(toPaise(100), toPaise(200), toPaise(300))).toBe(600);
  });

  it('returns 0 with no arguments', () => {
    expect(addPaise()).toBe(0);
  });
});

describe('subPaise', () => {
  it('subtracts correctly', () => {
    expect(subPaise(toPaise(6000), toPaise(900))).toBe(5100);
  });

  it('throws RangeError on underflow', () => {
    expect(() => subPaise(toPaise(100), toPaise(200))).toThrow(RangeError);
  });

  it('allows subtraction to zero', () => {
    expect(subPaise(toPaise(100), toPaise(100))).toBe(0);
  });
});
