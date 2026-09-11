import { describe, expect, it } from 'vitest';

import {
  rateAt,
  PLATFORM_COMMISSION_RATE_HISTORY,
  GST_RATE_HISTORY,
  PLATFORM_COMMISSION_RATE,
  GST_RATE,
  TCS_RATE,
  TDS_RATE,
  type DatedRate,
} from '../src/money/rates.js';
import { toRate } from '../src/primitives/paise.js';

describe('rateAt', () => {
  const twoEntryHistory: readonly DatedRate[] = [
    { rate: toRate(0.1), effectiveFrom: '2026-01-01', note: 'initial' },
    { rate: toRate(0.2), effectiveFrom: '2026-07-01', note: 'increased' },
  ];

  it('returns the older rate for a date before the switch', () => {
    const r = rateAt(twoEntryHistory, new Date('2026-03-15T12:00:00+05:30'));
    expect(r).toBe(0.1);
  });

  it('returns the newer rate for a date after the switch', () => {
    const r = rateAt(twoEntryHistory, new Date('2026-09-15T12:00:00+05:30'));
    expect(r).toBe(0.2);
  });

  it('returns the newer rate on the exact switch date', () => {
    const r = rateAt(twoEntryHistory, new Date('2026-07-01T00:00:00+05:30'));
    expect(r).toBe(0.2);
  });

  it('throws with an empty history', () => {
    expect(() => rateAt([], new Date())).toThrow(RangeError);
  });

  it('throws when the date is before all entries', () => {
    expect(() => rateAt(twoEntryHistory, new Date('2025-06-01T00:00:00+05:30'))).toThrow(
      RangeError,
    );
  });
});

describe('current rates', () => {
  it('platform commission is 0.15', () => {
    expect(PLATFORM_COMMISSION_RATE).toBe(0.15);
  });

  it('GST is 0.18', () => {
    expect(GST_RATE).toBe(0.18);
  });

  it('TCS is 0 (pending CA review)', () => {
    expect(TCS_RATE).toBe(0);
  });

  it('TDS is 0 (pending CA review)', () => {
    expect(TDS_RATE).toBe(0);
  });
});

describe('historical replay', () => {
  it('recomputing from rateAt on a future date gives the same launch rate', () => {
    const commissionRate = rateAt(
      PLATFORM_COMMISSION_RATE_HISTORY,
      new Date('2026-06-01T00:00:00+05:30'),
    );
    const gstRate = rateAt(GST_RATE_HISTORY, new Date('2026-06-01T00:00:00+05:30'));
    expect(commissionRate).toBe(0.15);
    expect(gstRate).toBe(0.18);
  });
});
