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
