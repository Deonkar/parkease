import type { Paise } from '@parkease/contracts/primitives';
import { describe, it, expect } from 'vitest';

import { formatPaise } from '../money';

const p = (n: number) => n as Paise;

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
});
