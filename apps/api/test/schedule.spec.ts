import { describe, expect, it } from 'vitest';

import { isOpenAt } from '../src/domains/space/schedule.js';

describe('isOpenAt', () => {
  it('returns true for 24x7 schedule', () => {
    expect(isOpenAt({ is24x7: true }, new Date('2026-01-05T03:00:00'))).toBe(true);
  });

  it('returns false on a closed day', () => {
    const schedule = {
      is24x7: false as const,
      days: {
        mon: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
        tue: { isOpen: false as const },
        wed: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
        thu: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
        fri: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
        sat: { isOpen: false as const },
        sun: { isOpen: false as const },
      },
    };
    // 2026-01-06 is a Tuesday
    expect(isOpenAt(schedule, new Date('2026-01-06T12:00:00'))).toBe(false);
  });

  it('returns true during open hours', () => {
    const schedule = {
      is24x7: false as const,
      days: {
        mon: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        tue: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        wed: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        thu: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        fri: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        sat: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
        sun: { isOpen: true as const, opensAt: '06:00', closesAt: '22:00' },
      },
    };
    // 2026-01-05 is a Monday
    expect(isOpenAt(schedule, new Date('2026-01-05T12:00:00'))).toBe(true);
  });

  it('returns false outside open hours', () => {
    const schedule = {
      is24x7: false as const,
      days: {
        mon: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        tue: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        wed: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        thu: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        fri: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        sat: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
        sun: { isOpen: true as const, opensAt: '09:00', closesAt: '17:00' },
      },
    };
    // 2026-01-05 is a Monday, 20:00 is after closing
    expect(isOpenAt(schedule, new Date('2026-01-05T20:00:00'))).toBe(false);
  });
});

/**
 * Opening hours are the owner's wall-clock hours in India, so `isOpenAt` must
 * read the instant in Asia/Kolkata (UTC+05:30) whatever the server's own TZ is.
 * Every instant below is written as UTC (`Z`) and asserted against its IST
 * reading, so these fail on a UTC server if the implementation ever goes back
 * to `getDay()`/`getHours()`.
 */
describe('isOpenAt evaluates in Asia/Kolkata, not the server timezone', () => {
  const nineToSix = {
    is24x7: false as const,
    days: {
      mon: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
      tue: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
      wed: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
      thu: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
      fri: { isOpen: true as const, opensAt: '09:00', closesAt: '18:00' },
      sat: { isOpen: false as const },
      sun: { isOpen: false as const },
    },
  };

  it('is open at 04:00Z on a Monday, which is 09:30 IST', () => {
    expect(isOpenAt(nineToSix, new Date('2026-01-05T04:00:00Z'))).toBe(true);
  });

  it('is closed at 13:00Z on a Monday, which is 18:30 IST — after closing', () => {
    expect(isOpenAt(nineToSix, new Date('2026-01-05T13:00:00Z'))).toBe(false);
  });

  it('is closed at 03:00Z on a Monday, which is 08:30 IST — before opening', () => {
    expect(isOpenAt(nineToSix, new Date('2026-01-05T03:00:00Z'))).toBe(false);
  });

  it('reads the IST weekday: 19:00Z Sunday is already Monday 00:30 IST', () => {
    // Monday is an open day, Sunday is not. A server reading UTC sees Sunday
    // and reports closed.
    const openAtHalfPastMidnight = {
      is24x7: false as const,
      days: {
        ...nineToSix.days,
        mon: { isOpen: true as const, opensAt: '00:00', closesAt: '23:59' },
      },
    };
    expect(isOpenAt(openAtHalfPastMidnight, new Date('2026-01-04T19:00:00Z'))).toBe(true);
  });

  it('reads the IST weekday backwards too: 18:00Z Monday is still Monday 23:30 IST', () => {
    const lateMonday = {
      is24x7: false as const,
      days: {
        ...nineToSix.days,
        mon: { isOpen: true as const, opensAt: '23:00', closesAt: '23:59' },
      },
    };
    expect(isOpenAt(lateMonday, new Date('2026-01-05T18:00:00Z'))).toBe(true);
  });

  it('treats opensAt as inclusive and closesAt as exclusive in IST', () => {
    // 03:30Z is exactly 09:00 IST, 12:30Z is exactly 18:00 IST.
    expect(isOpenAt(nineToSix, new Date('2026-01-05T03:30:00Z'))).toBe(true);
    expect(isOpenAt(nineToSix, new Date('2026-01-05T12:30:00Z'))).toBe(false);
  });
});
