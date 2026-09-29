import { describe, expect, it } from 'vitest';

import { payoutPeriod } from '../src/jobs/payout/period.js';

describe('payoutPeriod — ISO week in IST', () => {
  it('labels the Monday 06:00 IST run with its own week', () => {
    // Mon 28 Sep 2026, 06:00 IST = 00:30 UTC.
    expect(payoutPeriod(new Date('2026-09-28T00:30:00Z'))).toBe('2026-W40');
  });

  it('reads the day in IST, not UTC: Sunday 23:00 UTC is already Monday in India', () => {
    // Sun 27 Sep 23:00 UTC = Mon 28 Sep 04:30 IST.
    expect(payoutPeriod(new Date('2026-09-27T23:00:00Z'))).toBe('2026-W40');
    // Sun 27 Sep 18:00 UTC = Sun 23:30 IST — still week 39.
    expect(payoutPeriod(new Date('2026-09-27T18:00:00Z'))).toBe('2026-W39');
  });

  it('uses the ISO year at the boundary (1 Jan 2027 is a Friday in 2026-W53)', () => {
    expect(payoutPeriod(new Date('2027-01-01T06:00:00Z'))).toBe('2026-W53');
    expect(payoutPeriod(new Date('2027-01-04T06:00:00Z'))).toBe('2027-W01');
  });
});
