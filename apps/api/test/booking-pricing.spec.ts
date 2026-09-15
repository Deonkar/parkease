import type { SpacePricing } from '@parkease/contracts/owner';
import { toPaise } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import { PriceUnavailableError } from '../src/domains/booking/errors.js';
import { basePriceFor, billableUnits } from '../src/domains/pricing/duration.js';

const ist = (iso: string): Date => new Date(iso + '+05:30');

const PRICING: SpacePricing = {
  car: {
    hourlyPaise: toPaise(3000),
    dailyPaise: toPaise(20_000),
    weeklyPaise: toPaise(120_000),
    monthlyPaise: toPaise(400_000),
  },
  twoWheeler: { hourlyPaise: toPaise(1000) },
};

describe('billableUnits', () => {
  it('counts whole hours exactly', () => {
    expect(billableUnits('hourly', ist('2026-10-05T10:00'), ist('2026-10-05T12:00'))).toBe(2);
  });

  it('rounds a part-hour up to the next hour', () => {
    // A driver who overstays by a minute has occupied the slot for a third hour,
    // and the slot could not be sold to anyone else for it.
    expect(billableUnits('hourly', ist('2026-10-05T10:00'), ist('2026-10-05T12:01'))).toBe(3);
  });

  it('never bills zero units for a non-empty window', () => {
    expect(billableUnits('hourly', ist('2026-10-05T10:00'), ist('2026-10-05T10:01'))).toBe(1);
  });

  it('counts whole days', () => {
    expect(billableUnits('daily', ist('2026-10-05T10:00'), ist('2026-10-08T10:00'))).toBe(3);
  });

  it('rounds a part-day up', () => {
    expect(billableUnits('daily', ist('2026-10-05T10:00'), ist('2026-10-08T10:30'))).toBe(4);
  });

  it('counts whole weeks', () => {
    expect(billableUnits('weekly', ist('2026-10-05T10:00'), ist('2026-10-19T10:00'))).toBe(2);
  });

  it('counts calendar months, not 30-day blocks', () => {
    expect(billableUnits('monthly', ist('2027-01-01T10:00'), ist('2027-03-01T10:00'))).toBe(2);
    expect(billableUnits('monthly', ist('2027-02-01T10:00'), ist('2027-03-01T10:00'))).toBe(1);
  });

  it('rounds a part-month up', () => {
    expect(billableUnits('monthly', ist('2027-01-01T10:00'), ist('2027-03-02T10:00'))).toBe(3);
  });
});

describe('basePriceFor', () => {
  it('produces the task 8 worked example: 30 rupees an hour for two hours', () => {
    const base = basePriceFor(
      PRICING,
      'car',
      'hourly',
      ist('2026-10-05T10:00'),
      ist('2026-10-05T12:00'),
    );
    expect(base).toBe(6000);
  });

  it('prices a two-wheeler from its own rate card', () => {
    const base = basePriceFor(
      PRICING,
      'two_wheeler',
      'hourly',
      ist('2026-10-05T10:00'),
      ist('2026-10-05T13:00'),
    );
    expect(base).toBe(3000);
  });

  it('prices a daily booking from the daily rate, not 24 hourly units', () => {
    const base = basePriceFor(
      PRICING,
      'car',
      'daily',
      ist('2026-10-05T10:00'),
      ist('2026-10-06T10:00'),
    );
    expect(base).toBe(20_000);
  });

  it('refuses a duration the owner never priced', () => {
    expect(() =>
      basePriceFor(
        PRICING,
        'two_wheeler',
        'daily',
        ist('2026-10-05T10:00'),
        ist('2026-10-06T10:00'),
      ),
    ).toThrow(PriceUnavailableError);
  });

  it('refuses a vehicle type the owner never priced', () => {
    const carOnly: SpacePricing = { car: { hourlyPaise: toPaise(3000) } };
    expect(() =>
      basePriceFor(
        carOnly,
        'two_wheeler',
        'hourly',
        ist('2026-10-05T10:00'),
        ist('2026-10-05T11:00'),
      ),
    ).toThrow(PriceUnavailableError);
  });

  it('returns an integer number of paise for every duration type', () => {
    for (const durationType of ['hourly', 'daily', 'weekly', 'monthly'] as const) {
      const base = basePriceFor(
        PRICING,
        'car',
        durationType,
        ist('2026-10-05T10:00'),
        ist('2026-11-06T10:00'),
      );
      expect(Number.isInteger(base)).toBe(true);
    }
  });
});
