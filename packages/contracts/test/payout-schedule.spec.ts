import { describe, expect, it } from 'vitest';

import { istDateOf, MINIMUM_PAYOUT_PAISE, nextPayoutOn } from '../src/money/index.js';

describe('nextPayoutOn — the Monday 06:00 IST run', () => {
  it('is the coming Monday from midweek', () => {
    expect(nextPayoutOn(new Date('2026-09-30T10:00:00+05:30'))).toBe('2026-10-05');
  });

  it('is today on a Monday before 06:00 IST, and next week after it', () => {
    expect(nextPayoutOn(new Date('2026-10-05T05:59:00+05:30'))).toBe('2026-10-05');
    expect(nextPayoutOn(new Date('2026-10-05T06:00:00+05:30'))).toBe('2026-10-12');
  });

  it('reads the day in IST: Sunday 20:00 UTC is already Monday 01:30 in India', () => {
    expect(nextPayoutOn(new Date('2026-10-04T20:00:00Z'))).toBe('2026-10-05');
  });

  it('pays at ₹100 and above', () => {
    expect(MINIMUM_PAYOUT_PAISE).toBe(10_000);
  });
});

describe('istDateOf (task 16c)', () => {
  it('names the IST calendar day, which starts at 18:30 UTC the evening before', () => {
    expect(istDateOf(new Date('2027-01-04T18:29:59Z'))).toBe('2027-01-04');
    expect(istDateOf(new Date('2027-01-04T18:30:00Z'))).toBe('2027-01-05');
  });
});
