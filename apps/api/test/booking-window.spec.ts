import type { SpaceSchedule } from '@parkease/contracts/owner';
import { describe, expect, it } from 'vitest';

import { InvalidBookingWindowError } from '../src/domains/booking/errors.js';
import {
  CLOCK_SKEW_GRACE_MS,
  MAX_BOOKING_WINDOW_DAYS,
  assertWindowIsBookable,
} from '../src/domains/booking/window.js';

const ALWAYS_OPEN: SpaceSchedule = { is24x7: true };

/** 09:00–21:00 IST six days a week. Open every day but Sunday, never overnight. */
const DAYTIME: SpaceSchedule = {
  is24x7: false,
  days: {
    mon: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    tue: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    wed: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    thu: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    fri: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    sat: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    sun: { isOpen: false },
  },
};

/** IST wall clock to the UTC instant. IST is UTC+05:30 with no DST, ever. */
const ist = (iso: string): Date => new Date(iso + '+05:30');

// A Monday, comfortably ahead of the default `now` the tests pass.
const NOW = ist('2026-10-05T08:00');

const bookable =
  (
    schedule: SpaceSchedule,
    durationType: 'hourly' | 'daily' | 'weekly' | 'monthly',
    startsAt: Date,
    endsAt: Date,
    now: Date = NOW,
  ): (() => void) =>
  () => {
    assertWindowIsBookable(schedule, durationType, startsAt, endsAt, now);
  };

describe('assertWindowIsBookable', () => {
  describe('ordering', () => {
    it('rejects endsAt equal to startsAt', () => {
      const at = ist('2026-10-05T10:00');
      expect(bookable(ALWAYS_OPEN, 'hourly', at, at)).toThrow(InvalidBookingWindowError);
    });

    it('rejects endsAt before startsAt', () => {
      expect(
        bookable(ALWAYS_OPEN, 'hourly', ist('2026-10-05T12:00'), ist('2026-10-05T10:00')),
      ).toThrow(InvalidBookingWindowError);
    });
  });

  describe('minimum duration per type', () => {
    it('rejects an hourly booking under 60 minutes', () => {
      expect(
        bookable(ALWAYS_OPEN, 'hourly', ist('2026-10-05T10:00'), ist('2026-10-05T10:59')),
      ).toThrow(/at least 1 hour/i);
    });

    it('accepts an hourly booking of exactly 60 minutes', () => {
      expect(
        bookable(ALWAYS_OPEN, 'hourly', ist('2026-10-05T10:00'), ist('2026-10-05T11:00')),
      ).not.toThrow();
    });

    it('rejects a daily booking under 24 hours', () => {
      expect(
        bookable(ALWAYS_OPEN, 'daily', ist('2026-10-05T10:00'), ist('2026-10-06T09:59')),
      ).toThrow(/at least 1 day/i);
    });

    it('accepts a daily booking of exactly 24 hours', () => {
      expect(
        bookable(ALWAYS_OPEN, 'daily', ist('2026-10-05T10:00'), ist('2026-10-06T10:00')),
      ).not.toThrow();
    });

    it('rejects a weekly booking under 7 days', () => {
      expect(
        bookable(ALWAYS_OPEN, 'weekly', ist('2026-10-05T10:00'), ist('2026-10-12T09:59')),
      ).toThrow(/at least 7 days/i);
    });

    it('accepts a weekly booking of exactly 7 days', () => {
      expect(
        bookable(ALWAYS_OPEN, 'weekly', ist('2026-10-05T10:00'), ist('2026-10-12T10:00')),
      ).not.toThrow();
    });

    it('rejects a monthly booking under one calendar month', () => {
      expect(
        bookable(ALWAYS_OPEN, 'monthly', ist('2026-10-05T10:00'), ist('2026-11-05T09:59')),
      ).toThrow(/at least 1 month/i);
    });

    it('accepts a monthly booking of exactly one calendar month', () => {
      expect(
        bookable(ALWAYS_OPEN, 'monthly', ist('2026-10-05T10:00'), ist('2026-11-05T10:00')),
      ).not.toThrow();
    });

    it('measures a month as a calendar month, not 30 days', () => {
      // February 2027 is 28 days. A flat 30-day floor would reject a legitimate
      // February-to-March monthly booking.
      expect(
        bookable(
          ALWAYS_OPEN,
          'monthly',
          ist('2027-02-01T10:00'),
          ist('2027-03-01T10:00'),
          ist('2027-01-31T10:00'),
        ),
      ).not.toThrow();
    });

    it('clamps a month-end start to the shorter month', () => {
      // 31 Jan plus one month has no 31 February; the floor lands on 28 February.
      expect(
        bookable(
          ALWAYS_OPEN,
          'monthly',
          ist('2027-01-31T10:00'),
          ist('2027-02-28T10:00'),
          ist('2027-01-30T10:00'),
        ),
      ).not.toThrow();
    });
  });

  describe('the past', () => {
    it('rejects a start further back than the clock-skew grace', () => {
      const now = ist('2026-10-05T10:00');
      const startsAt = new Date(now.getTime() - CLOCK_SKEW_GRACE_MS - 1000);
      expect(
        bookable(ALWAYS_OPEN, 'hourly', startsAt, new Date(startsAt.getTime() + 3_600_000), now),
      ).toThrow(/in the past/i);
    });

    it('accepts a start inside the clock-skew grace', () => {
      const now = ist('2026-10-05T10:00');
      const startsAt = new Date(now.getTime() - CLOCK_SKEW_GRACE_MS + 1000);
      expect(
        bookable(ALWAYS_OPEN, 'hourly', startsAt, new Date(startsAt.getTime() + 3_600_000), now),
      ).not.toThrow();
    });
  });

  describe('opening hours', () => {
    it('accepts a window wholly inside opening hours', () => {
      expect(
        bookable(DAYTIME, 'hourly', ist('2026-10-05T10:00'), ist('2026-10-05T12:00')),
      ).not.toThrow();
    });

    it('accepts a window that ends exactly at closing time', () => {
      expect(
        bookable(DAYTIME, 'hourly', ist('2026-10-05T20:00'), ist('2026-10-05T21:00')),
      ).not.toThrow();
    });

    it('rejects a window that crosses closing time', () => {
      expect(bookable(DAYTIME, 'hourly', ist('2026-10-05T20:30'), ist('2026-10-05T21:30'))).toThrow(
        /opening hours/i,
      );
    });

    it('rejects a window that starts before opening time', () => {
      expect(bookable(DAYTIME, 'hourly', ist('2026-10-05T08:00'), ist('2026-10-05T10:00'))).toThrow(
        /opening hours/i,
      );
    });

    it('rejects a window on a day the space is closed', () => {
      // 11 October 2026 is a Sunday.
      expect(bookable(DAYTIME, 'hourly', ist('2026-10-11T10:00'), ist('2026-10-11T12:00'))).toThrow(
        /closed/i,
      );
    });

    it('accepts the same closing-time-crossing window on a 24x7 space', () => {
      expect(
        bookable(ALWAYS_OPEN, 'hourly', ist('2026-10-05T20:30'), ist('2026-10-05T21:30')),
      ).not.toThrow();
    });
  });

  describe('the IST midnight boundary', () => {
    it('evaluates the day in Asia/Kolkata, not UTC', () => {
      // 18:30Z on Sunday 11 Oct is 00:00 IST on Monday 12 Oct. Read as UTC this is
      // Sunday, when DAYTIME is closed; read in IST it is Monday, before opening.
      // Both reject, but only the IST reading gives the opening-hours reason.
      expect(bookable(DAYTIME, 'hourly', ist('2026-10-12T00:00'), ist('2026-10-12T01:00'))).toThrow(
        /opening hours/i,
      );
    });

    it('rejects a window spanning IST midnight on a scheduled space', () => {
      expect(bookable(DAYTIME, 'daily', ist('2026-10-05T10:00'), ist('2026-10-06T10:00'))).toThrow(
        /opening hours/i,
      );
    });

    it('accepts a window spanning IST midnight on a 24x7 space', () => {
      expect(
        bookable(ALWAYS_OPEN, 'daily', ist('2026-10-05T10:00'), ist('2026-10-06T10:00')),
      ).not.toThrow();
    });

    it('does not walk into the next day when the window ends at IST midnight', () => {
      // Saturday 22:00 to Sunday 00:00. The half-open window occupies no part of
      // Sunday, so the reason must be Saturday's closing time, not Sunday being
      // closed. A day-walk that iterates the zero-length final day says "closed",
      // which is both the wrong reason and the wrong day.
      const openLateSaturday: SpaceSchedule = {
        is24x7: false,
        days: { ...DAYTIME.days, sat: { isOpen: true, opensAt: '09:00', closesAt: '23:59' } },
      };
      expect(
        bookable(openLateSaturday, 'hourly', ist('2026-10-10T22:00'), ist('2026-10-11T00:00')),
      ).toThrow(/opening hours/i);
    });
  });

  describe('the upper bound', () => {
    it('rejects a window longer than the maximum rather than walking it day by day', () => {
      const startsAt = ist('2026-10-05T10:00');
      const endsAt = new Date(startsAt.getTime() + (MAX_BOOKING_WINDOW_DAYS + 1) * 86_400_000);
      expect(bookable(ALWAYS_OPEN, 'monthly', startsAt, endsAt)).toThrow(/too long/i);
    });
  });
});
