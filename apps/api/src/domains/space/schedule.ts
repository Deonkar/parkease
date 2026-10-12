import type { SpaceSchedule } from '@parkease/contracts/owner';

/** The keys of the weekly schedule, as the contract shapes them. */
type DayKey = keyof Extract<SpaceSchedule, { is24x7: false }>['days'];

/**
 * Opening hours are the owner's wall-clock hours in India. Reading them with
 * `Date#getDay()`/`getHours()` evaluates them in the *server's* timezone, so a
 * UTC host reports every space closed for the 5.5 hours IST runs ahead. The
 * zone is fixed, not configurable: ParkEase is an India-only marketplace.
 */
const IST = 'Asia/Kolkata';

const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Intl's `weekday: 'short'` in en-GB, lowercased, is already our day key. */
const WEEKDAY_KEYS: Readonly<Record<string, DayKey>> = {
  mon: 'mon',
  tue: 'tue',
  wed: 'wed',
  thu: 'thu',
  fri: 'fri',
  sat: 'sat',
  sun: 'sun',
};

interface IstParts {
  readonly dayKey: DayKey;
  readonly hhmm: string;
}

function partsInIst(instant: Date): IstParts | undefined {
  let weekday: string | undefined;
  let hour: string | undefined;
  let minute: string | undefined;

  for (const part of IST_PARTS.formatToParts(instant)) {
    if (part.type === 'weekday') weekday = part.value.toLowerCase();
    else if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
  }

  if (weekday === undefined || hour === undefined || minute === undefined) return undefined;

  const dayKey = WEEKDAY_KEYS[weekday];
  if (dayKey === undefined) return undefined;

  // Some ICU builds render midnight as "24" under hour12: false.
  const normalisedHour = hour === '24' ? '00' : hour;

  return { dayKey, hhmm: `${normalisedHour}:${minute}` };
}

export function isOpenAt(schedule: SpaceSchedule, instant: Date): boolean {
  if (schedule.is24x7) return true;

  const parts = partsInIst(instant);
  if (parts === undefined) return false;

  const day = schedule.days[parts.dayKey];
  if (!day.isOpen) return false;

  // HH:mm strings compare correctly lexicographically — both are zero-padded.
  return parts.hhmm >= day.opensAt && parts.hhmm < day.closesAt;
}

/** India Standard Time is UTC+05:30 all year (no DST), so IST wall time is a fixed offset. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 86_400_000;
const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * The hours in `[from, to)` during which the space is open (S-82): the occupancy denominator. A
 * 24x7 space is open the whole window; otherwise each IST calendar day's open interval is
 * intersected with the window and the overlaps summed. A schedule's day never crosses midnight
 * (`opensAt < closesAt`, by contract), so one interval per day is the whole story.
 */
export function openHoursWithin(schedule: SpaceSchedule, from: Date, to: Date): number {
  const start = from.getTime();
  const end = to.getTime();
  if (end <= start) return 0;
  if (schedule.is24x7) return (end - start) / 3_600_000;

  let openMs = 0;
  // IST midnight at or before `from`, in UTC milliseconds.
  let dayStart = Math.floor((start + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  for (; dayStart < end; dayStart += DAY_MS) {
    const dayKey = DAY_KEYS[new Date(dayStart + IST_OFFSET_MS).getUTCDay()];
    if (dayKey === undefined) continue;
    const day = schedule.days[dayKey];
    if (!day.isOpen) continue;
    const opens = dayStart + minutesOf(day.opensAt) * 60_000;
    const closes = dayStart + minutesOf(day.closesAt) * 60_000;
    openMs += Math.max(0, Math.min(closes, end) - Math.max(opens, start));
  }
  return openMs / 3_600_000;
}
