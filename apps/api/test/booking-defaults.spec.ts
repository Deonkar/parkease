import type { SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';
import { toPaise } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOURS,
  defaultWindowFor,
  nextRoundedStart,
} from '../src/domains/booking/defaults.js';

const ist = (iso: string): Date => new Date(iso + '+05:30');

const OPEN_ALWAYS: SpaceSchedule = { is24x7: true };

/** 09:00–21:00 IST, every day. */
const DAYTIME: SpaceSchedule = {
  is24x7: false,
  days: {
    mon: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    tue: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    wed: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    thu: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    fri: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    sat: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
    sun: { isOpen: true, opensAt: '09:00', closesAt: '21:00' },
  },
};

const BOTH: SpacePricing = {
  car: { hourlyPaise: toPaise(3000) },
  twoWheeler: { hourlyPaise: toPaise(1000) },
};
const CAR_ONLY: SpacePricing = { car: { hourlyPaise: toPaise(3000) } };

const BOTH_FREE = { car: 2, twoWheeler: 2 };
const NONE_FREE = { car: 0, twoWheeler: 0 };

describe('nextRoundedStart', () => {
  it('rounds up to the next five-minute mark', () => {
    expect(nextRoundedStart(ist('2026-10-05T10:03:47')).toISOString()).toBe(
      ist('2026-10-05T10:05:00').toISOString(),
    );
  });

  it('leaves an exact mark alone', () => {
    expect(nextRoundedStart(ist('2026-10-05T10:05:00')).toISOString()).toBe(
      ist('2026-10-05T10:05:00').toISOString(),
    );
  });

  it('never rounds into the past', () => {
    // Rounding to nearest would put 10:02 at 10:00, behind `now`, and the window
    // validator would then reject a default the driver never touched.
    for (const minute of [1, 2, 3, 4, 14, 29, 58]) {
      const now = ist(`2026-10-05T10:${String(minute).padStart(2, '0')}:30`);
      expect(nextRoundedStart(now).getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });
});

describe('defaultWindowFor', () => {
  const at = (now: Date) => ({
    pricing: BOTH,
    schedule: OPEN_ALWAYS,
    availableNow: BOTH_FREE,
    now,
  });

  it('offers two hours from the next rounded start', () => {
    const window = defaultWindowFor(at(ist('2026-10-05T10:03')));
    expect(window?.hours).toBe(DEFAULT_HOURS);
    expect(window?.durationType).toBe('hourly');
    expect(window?.startsAt.toISOString()).toBe(ist('2026-10-05T10:05').toISOString());
    expect(window?.endsAt.toISOString()).toBe(ist('2026-10-05T12:05').toISOString());
  });

  it('prefers a car when cars are free', () => {
    expect(defaultWindowFor(at(ist('2026-10-05T10:00')))?.vehicleType).toBe('car');
  });

  it('falls back to a two-wheeler when no car slot is free', () => {
    // Following what is actually free, rather than a stored preference: a
    // preference that no longer fits produces a SLOT_UNAVAILABLE the driver
    // cannot explain.
    const window = defaultWindowFor({
      pricing: BOTH,
      schedule: OPEN_ALWAYS,
      availableNow: { car: 0, twoWheeler: 3 },
      now: ist('2026-10-05T10:00'),
    });
    expect(window?.vehicleType).toBe('two_wheeler');
  });

  it('offers nothing when nothing is free', () => {
    expect(
      defaultWindowFor({
        pricing: BOTH,
        schedule: OPEN_ALWAYS,
        availableNow: NONE_FREE,
        now: ist('2026-10-05T10:00'),
      }),
    ).toBeUndefined();
  });

  it('offers nothing when the only free slots are for an unpriced vehicle', () => {
    expect(
      defaultWindowFor({
        pricing: CAR_ONLY,
        schedule: OPEN_ALWAYS,
        availableNow: { car: 0, twoWheeler: 4 },
        now: ist('2026-10-05T10:00'),
      }),
    ).toBeUndefined();
  });

  it('offers a window that fits inside opening hours', () => {
    const window = defaultWindowFor({
      pricing: BOTH,
      schedule: DAYTIME,
      availableNow: BOTH_FREE,
      now: ist('2026-10-05T10:00'),
    });
    expect(window?.endsAt.toISOString()).toBe(ist('2026-10-05T12:00').toISOString());
  });

  /**
   * The reason the default is validated rather than just computed. A space that
   * closes in twenty minutes must not offer a two-hour button that 400s the
   * instant it is tapped — the screen falls back to "Choose a time" instead.
   */
  it('offers nothing when two hours would run past closing time', () => {
    expect(
      defaultWindowFor({
        pricing: BOTH,
        schedule: DAYTIME,
        availableNow: BOTH_FREE,
        now: ist('2026-10-05T20:40'),
      }),
    ).toBeUndefined();
  });

  it('offers nothing before the space opens', () => {
    expect(
      defaultWindowFor({
        pricing: BOTH,
        schedule: DAYTIME,
        availableNow: BOTH_FREE,
        now: ist('2026-10-05T06:00'),
      }),
    ).toBeUndefined();
  });

  it('offers nothing when the hourly rate is zero', () => {
    expect(
      defaultWindowFor({
        pricing: { car: { hourlyPaise: toPaise(0) } },
        schedule: OPEN_ALWAYS,
        availableNow: { car: 3, twoWheeler: 0 },
        now: ist('2026-10-05T10:00'),
      }),
    ).toBeUndefined();
  });

  it('never returns a window the booking validator would reject', () => {
    // The property that matters: whatever this offers, the create path accepts.
    // Anything else is a button that fails the moment it is pressed.
    const nows = ['08:00', '09:00', '12:34', '18:59', '20:59', '23:30'];
    for (const clock of nows) {
      for (const schedule of [OPEN_ALWAYS, DAYTIME]) {
        const now = ist(`2026-10-05T${clock}`);
        const window = defaultWindowFor({
          pricing: BOTH,
          schedule,
          availableNow: BOTH_FREE,
          now,
        });
        if (window === undefined) continue;
        expect(window.startsAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
        expect(window.endsAt.getTime()).toBeGreaterThan(window.startsAt.getTime());
      }
    }
  });
});
