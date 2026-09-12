import { describe, it, expect } from 'vitest';

import { formatDistance, formatDateIST, formatTimeIST } from '../format';

describe('formatDistance', () => {
  it('formats meters under 1km', () => {
    expect(formatDistance(500)).toBe('500 m');
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('formats km with one decimal under 10km', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(3200)).toBe('3.2 km');
    expect(formatDistance(9999)).toBe('10.0 km');
  });

  it('formats km as whole numbers at 10km+', () => {
    expect(formatDistance(10000)).toBe('10 km');
    expect(formatDistance(25600)).toBe('26 km');
  });
});

describe('formatDateIST', () => {
  it('formats a UTC date to IST', () => {
    const date = new Date('2026-01-15T06:30:00Z');
    const result = formatDateIST(date);
    expect(result).toBe('15 Jan 2026');
  });
});

describe('formatTimeIST', () => {
  it('formats time in 12-hour IST', () => {
    const date = new Date('2026-01-15T06:30:00Z');
    const result = formatTimeIST(date);
    expect(result).toBe('12:00 PM');
  });

  it('handles midnight UTC → 5:30 AM IST', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    const result = formatTimeIST(date);
    expect(result).toBe('5:30 AM');
  });
});
