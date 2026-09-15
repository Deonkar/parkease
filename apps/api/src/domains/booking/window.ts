import type { DurationType } from '@parkease/contracts/enums';
import type { SpaceSchedule } from '@parkease/contracts/owner';

import { InvalidBookingWindowError } from './errors.js';

/**
 * Opening hours are the owner's wall-clock hours in India, so every calendar
 * question in this file is asked in IST. The zone is fixed, not configurable:
 * ParkEase is an India-only marketplace, and IST has never observed DST, which is
 * why a fixed +05:30 offset is safe arithmetic rather than a latent bug.
 */
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

/** A client clock a couple of minutes behind ours must not lose its booking. */
export const CLOCK_SKEW_GRACE_MS = 2 * 60 * 1000;

/**
 * An upper bound on the window, checked before the day-by-day walk below.
 * Without it a request for a thousand-year window turns a validation call into a
 * 365,000-iteration loop on an unauthenticated-adjacent path.
 */
export const MAX_BOOKING_WINDOW_DAYS = 366;

type DayKey = keyof Extract<SpaceSchedule, { is24x7: false }>['days'];

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface IstMoment {
  /** Days since the Unix epoch, counted in IST rather than UTC. */
  readonly dayNumber: number;
  /** Minutes since IST midnight, 0–1439. */
  readonly minuteOfDay: number;
}

/**
 * Shifting the instant by the IST offset lets plain UTC accessors read IST
 * wall-clock parts. This is the same trick `Intl` would do, without formatting
 * and re-parsing a string for every day of a monthly booking.
 */
function inIst(instant: Date): IstMoment {
  const shifted = instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE;
  const totalMinutes = Math.floor(shifted / MS_PER_MINUTE);
  return {
    dayNumber: Math.floor(totalMinutes / MINUTES_PER_DAY),
    minuteOfDay: ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY,
  };
}

/** 1 January 1970 was a Thursday, which is index 4 in a Sunday-first week. */
function dayKeyOf(dayNumber: number): DayKey {
  const index = (((dayNumber + 4) % 7) + 7) % 7;
  return DAY_KEYS[index] as DayKey;
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** IST calendar parts, for the calendar-month arithmetic a monthly booking needs. */
function istParts(instant: Date): { year: number; month: number; day: number; timeMs: number } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    timeMs:
      shifted.getUTCHours() * 3_600_000 +
      shifted.getUTCMinutes() * 60_000 +
      shifted.getUTCSeconds() * 1000 +
      shifted.getUTCMilliseconds(),
  };
}

/**
 * One calendar month after `from`, in IST, clamped into a shorter month: 31
 * January plus a month is 28 February, not 3 March. A flat 30 days would both
 * over-reject a February booking and under-charge a 31-day one.
 */
export function oneMonthAfter(from: Date): Date {
  const { year, month, day, timeMs } = istParts(from);
  const daysInTarget = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTarget);
  const shifted = Date.UTC(year, month + 1, clampedDay) + timeMs;
  return new Date(shifted - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

const MINIMUM_MS: Readonly<Record<Exclude<DurationType, 'monthly'>, number>> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const MINIMUM_LABEL: Readonly<Record<DurationType, string>> = {
  hourly: 'at least 1 hour',
  daily: 'at least 1 day',
  weekly: 'at least 7 days',
  monthly: 'at least 1 month',
};

function assertMinimumDuration(durationType: DurationType, startsAt: Date, endsAt: Date): void {
  const longEnough =
    durationType === 'monthly'
      ? endsAt.getTime() >= oneMonthAfter(startsAt).getTime()
      : endsAt.getTime() - startsAt.getTime() >= MINIMUM_MS[durationType];

  if (!longEnough) {
    throw new InvalidBookingWindowError(
      `A ${durationType} booking must be ${MINIMUM_LABEL[durationType]}.`,
    );
  }
}

/**
 * Every minute of the window must fall inside the space's opening hours, so the
 * window is walked one IST day at a time. Checking only the two endpoints would
 * wave through a Friday-to-Monday booking that sits closed all weekend.
 *
 * The walk is half-open, matching the `[)` bounds of the `tstzrange` this window
 * becomes: a window ending exactly at IST midnight occupies no part of the next
 * day, so that day is never examined.
 */
function assertInsideOpeningHours(schedule: SpaceSchedule, startsAt: Date, endsAt: Date): void {
  if (schedule.is24x7) return;

  const start = inIst(startsAt);
  const end = inIst(endsAt);

  for (let dayNumber = start.dayNumber; dayNumber <= end.dayNumber; dayNumber++) {
    const fromMinute = dayNumber === start.dayNumber ? start.minuteOfDay : 0;
    const toMinute = dayNumber === end.dayNumber ? end.minuteOfDay : MINUTES_PER_DAY;

    if (fromMinute >= toMinute) continue;

    const day = schedule.days[dayKeyOf(dayNumber)];
    if (!day.isOpen) {
      throw new InvalidBookingWindowError('This space is closed on one of the days you picked.');
    }

    if (fromMinute < minutesOf(day.opensAt) || toMinute > minutesOf(day.closesAt)) {
      throw new InvalidBookingWindowError(
        "That window falls outside this space's opening hours. Pick a time while it is open.",
      );
    }
  }
}

/**
 * The boring rules that are nonetheless product requirements (prd.md §8). Pure,
 * so `now` is a parameter rather than a call to the clock — a validator that
 * reads the wall clock cannot be tested at a boundary.
 */
export function assertWindowIsBookable(
  schedule: SpaceSchedule,
  durationType: DurationType,
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new InvalidBookingWindowError('Those dates are not valid.');
  }

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new InvalidBookingWindowError('The end time must be after the start time.');
  }

  if (startsAt.getTime() < now.getTime() - CLOCK_SKEW_GRACE_MS) {
    throw new InvalidBookingWindowError('You cannot book a time in the past.');
  }

  const spanDays = (endsAt.getTime() - startsAt.getTime()) / 86_400_000;
  if (spanDays > MAX_BOOKING_WINDOW_DAYS) {
    throw new InvalidBookingWindowError(
      `That booking is too long. The longest we take is ${String(MAX_BOOKING_WINDOW_DAYS)} days.`,
    );
  }

  assertMinimumDuration(durationType, startsAt, endsAt);
  assertInsideOpeningHours(schedule, startsAt, endsAt);
}
