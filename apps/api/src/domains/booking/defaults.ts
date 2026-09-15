import type { VehicleType } from '@parkease/contracts/enums';
import type { SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';

import { assertWindowIsBookable } from './window.js';

/** The default stay. Two hours covers a meal, a film, or an appointment. */
export const DEFAULT_HOURS = 2;

/** Start times are rounded to this, so they read as a time and not a timestamp. */
const ROUND_TO_MINUTES = 5;
const MS_PER_MINUTE = 60_000;

export interface DefaultWindow {
  readonly vehicleType: VehicleType;
  readonly durationType: 'hourly';
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly hours: number;
}

/**
 * The next clean five-minute mark, never in the past.
 *
 * Rounding *up* rather than to nearest is load-bearing: rounding down would put
 * the start behind `now`, and the window validator would reject a booking the
 * driver never edited.
 */
export function nextRoundedStart(now: Date): Date {
  const step = ROUND_TO_MINUTES * MS_PER_MINUTE;
  return new Date(Math.ceil(now.getTime() / step) * step);
}

/**
 * What "book now" means for this space, decided server-side.
 *
 * It lives here rather than in the app for one reason: the client is not allowed
 * to produce a price (R-FE-06), so whatever window the button offers has to be
 * the same window the server quoted. Two definitions of "the default" — one
 * choosing the window, one pricing it — is how a button ends up promising a
 * number the next screen contradicts.
 *
 * Vehicle type follows what is actually free rather than a stored preference: a
 * preference that no longer fits produces a SLOT_UNAVAILABLE the driver cannot
 * explain. Returns `undefined` when there is nothing honest to offer.
 */
export function defaultWindowFor(input: {
  readonly pricing: SpacePricing;
  readonly schedule: SpaceSchedule;
  readonly availableNow: { car: number; twoWheeler: number };
  readonly now: Date;
}): DefaultWindow | undefined {
  const { pricing, schedule, availableNow, now } = input;

  const carUsable = pricing.car !== undefined && availableNow.car > 0;
  const twoWheelerUsable = pricing.twoWheeler !== undefined && availableNow.twoWheeler > 0;

  if (!carUsable && !twoWheelerUsable) return undefined;

  const vehicleType: VehicleType = carUsable ? 'car' : 'two_wheeler';
  const card = vehicleType === 'car' ? pricing.car : pricing.twoWheeler;
  if (card === undefined || card.hourlyPaise <= 0) return undefined;

  const startsAt = nextRoundedStart(now);
  const endsAt = new Date(startsAt.getTime() + DEFAULT_HOURS * 60 * MS_PER_MINUTE);

  // The default has to survive the same validator the real booking will face —
  // opening hours included. A space that closes in twenty minutes must not
  // offer a two-hour button that 400s the moment it is tapped.
  try {
    assertWindowIsBookable(schedule, 'hourly', startsAt, endsAt, { now });
  } catch {
    // Not an error: this space simply has no sensible default right now, and the
    // screen falls back to "Choose a time". Swallowing is correct here precisely
    // because the failure is the answer, not a fault (R-FAIL-01).
    return undefined;
  }

  return { vehicleType, durationType: 'hourly', startsAt, endsAt, hours: DEFAULT_HOURS };
}
