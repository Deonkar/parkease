import type { DurationType, VehicleType } from '@parkease/contracts/enums';
import type { DurationPricing, SpacePricing } from '@parkease/contracts/owner';
import { type Paise, toPaise } from '@parkease/contracts/primitives';

import { PriceUnavailableError } from '../booking/errors.js';
import { oneMonthAfter } from '../booking/window.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const FIXED_UNIT_MS: Readonly<Record<Exclude<DurationType, 'monthly'>, number>> = {
  hourly: MS_PER_HOUR,
  daily: MS_PER_DAY,
  weekly: MS_PER_WEEK,
};

/**
 * Months are the one unit that is not a fixed number of milliseconds, so they are
 * counted by walking the calendar in IST rather than dividing. Thirty-day blocks
 * would charge a February booking for more month than February has.
 */
function calendarMonths(startsAt: Date, endsAt: Date): number {
  let months = 0;
  let cursor = startsAt;
  while (cursor.getTime() < endsAt.getTime()) {
    cursor = oneMonthAfter(cursor);
    months++;
  }
  return months;
}

/**
 * Part-units round up. A driver who overstays by a minute has held the slot for
 * the whole next unit, and nobody else could be sold it for that time.
 */
export function billableUnits(durationType: DurationType, startsAt: Date, endsAt: Date): number {
  if (durationType === 'monthly') return calendarMonths(startsAt, endsAt);

  const span = endsAt.getTime() - startsAt.getTime();
  return Math.max(1, Math.ceil(span / FIXED_UNIT_MS[durationType]));
}

const RATE_KEY: Readonly<Record<DurationType, keyof DurationPricing>> = {
  hourly: 'hourlyPaise',
  daily: 'dailyPaise',
  weekly: 'weeklyPaise',
  monthly: 'monthlyPaise',
};

/**
 * The base price, before surge, fee or tax. `domains/pricing` is the only module
 * that produces a money amount (R-ARCH-06), and this is where the rate card meets
 * the clock.
 */
export function basePriceFor(
  pricing: SpacePricing,
  vehicleType: VehicleType,
  durationType: DurationType,
  startsAt: Date,
  endsAt: Date,
): Paise {
  const card = vehicleType === 'car' ? pricing.car : pricing.twoWheeler;
  if (card === undefined) {
    throw new PriceUnavailableError('This space does not take that kind of vehicle.');
  }

  const rate = card[RATE_KEY[durationType]];
  if (rate === undefined || rate <= 0) {
    throw new PriceUnavailableError(`This space is not priced ${durationType}. Pick another plan.`);
  }

  return toPaise(rate * billableUnits(durationType, startsAt, endsAt));
}
