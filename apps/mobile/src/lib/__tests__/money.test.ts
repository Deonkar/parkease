import type { Paise, PaiseDelta } from '@parkease/contracts/primitives';
import { describe, it, expect } from 'vitest';

import { formatPaise } from '../money';

const p = (n: number) => n as Paise;
const d = (n: number) => n as PaiseDelta;

describe('formatPaise', () => {
  it.each([
    [6000, '₹60'],
    [9702, '₹97.02'],
    [5100, '₹51'],
    [702, '₹7.02'],
    [1280000, '₹12,800'],
    [10000000, '₹1,00,000'],
    [100000000, '₹10,00,000'],
    [1000000000, '₹1,00,00,000'],
    [0, '₹0'],
  ])('formats %i paise as %s', (input, expected) => {
    expect(formatPaise(p(input))).toBe(expected);
  });

  it.each([
    [6000, '₹60.00'],
    [9702, '₹97.02'],
    [5100, '₹51.00'],
    [702, '₹7.02'],
    [0, '₹0.00'],
    [1280000, '₹12,800.00'],
    [10000000, '₹1,00,000.00'],
  ])('formats %i paise with alwaysDecimals as %s', (input, expected) => {
    expect(formatPaise(p(input), { alwaysDecimals: true })).toBe(expected);
  });

  it('drops ₹ symbol when symbol: false', () => {
    expect(formatPaise(p(1280000), { symbol: false })).toBe('12,800');
    expect(formatPaise(p(10000000), { symbol: false })).toBe('1,00,000');
  });

  it('renders the canonical ADR-009 breakdown correctly', () => {
    const breakdown = {
      basePaise: p(6000),
      surgePaise: p(3000),
      gstPaise: p(702),
      totalPaise: p(9702),
      ownerEarnsPaise: p(5100),
    };

    const opts = { alwaysDecimals: true } as const;
    expect(formatPaise(breakdown.basePaise, opts)).toBe('₹60.00');
    expect(formatPaise(breakdown.surgePaise, opts)).toBe('₹30.00');
    expect(formatPaise(breakdown.gstPaise, opts)).toBe('₹7.02');
    expect(formatPaise(breakdown.totalPaise, opts)).toBe('₹97.02');
    expect(formatPaise(breakdown.ownerEarnsPaise, opts)).toBe('₹51.00');

    const total = breakdown.basePaise + breakdown.surgePaise + breakdown.gstPaise;
    expect(total).toBe(breakdown.totalPaise);
  });

  it('handles single-digit paise correctly', () => {
    expect(formatPaise(p(1))).toBe('₹0.01');
    expect(formatPaise(p(99))).toBe('₹0.99');
  });

  describe('a signed amount (a period net can be a clawback)', () => {
    // U+2212 MINUS SIGN, not a hyphen: TalkBack reads it as "minus", and it is
    // the width of a digit, so a negative figure does not look shorter.
    it.each([
      [-31920, '−₹319.20'],
      [-100, '−₹1'],
      [-1, '−₹0.01'],
      [-10000000, '−₹1,00,000'],
      [0, '₹0'],
      [31920, '₹319.20'],
    ])('formats %i paise as %s', (input, expected) => {
      expect(formatPaise(d(input))).toBe(expected);
    });

    it('never splits the sign across the rupees and the paise', () => {
      // The bug this replaces: Math.trunc and % both carry the sign, which
      // rendered -31920 as "₹-319.-20".
      expect(formatPaise(d(-31920))).not.toContain('-');
    });

    it('keeps the minus in front of the number when the symbol is dropped', () => {
      expect(formatPaise(d(-31920), { symbol: false })).toBe('−319.20');
    });

    it('keeps the decimals option for a negative amount', () => {
      expect(formatPaise(d(-100), { alwaysDecimals: true })).toBe('−₹1.00');
    });
  });
});
