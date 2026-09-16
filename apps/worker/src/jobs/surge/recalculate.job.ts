import {
  type Day,
  daySchema,
  NO_SURGE_BP,
  type PeakWindow,
  type SurgeSnapshot,
  type ZoneId,
} from '@parkease/contracts/admin';
import { calculateSurge } from '@parkease/contracts/money';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { resolveSurgeConfig } from './config.js';
import { measureZoneOccupancy } from './occupancy.js';

export const SURGE_RECALCULATE = 'surge.recalculate';

/**
 * 100 seconds longer than two cron intervals, so a single missed run degrades
 * to stale-but-valid surge rather than to a sudden platform-wide price drop.
 */
export const SURGE_TTL_SECONDS = 600;

export const surgeKey = (zoneId: ZoneId): string => `surge:${zoneId}`;

const IST = 'Asia/Kolkata';
const WEEKEND_DAYS: readonly Day[] = ['sat', 'sun'];

/** en-GB renders a short weekday as three letters: "Mon", "Thu", "Sat". */
const DAY_ABBREVIATION_LENGTH = 3;

/**
 * `hourCycle: 'h23'` rather than `hour12: false`, which renders midnight as
 * "24" under some ICU builds and would put 00:15 IST outside every window that
 * starts at 00:00.
 */
const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface IstMoment {
  readonly day: Day;
  /** HH:MM, zero-padded, so a lexical compare is a chronological one. */
  readonly time: string;
}

function istMoment(at: Date): IstMoment {
  const parts = new Map(istParts.formatToParts(at).map((part) => [part.type, part.value]));
  const weekday = (parts.get('weekday') ?? '')
    .slice(0, DAY_ABBREVIATION_LENGTH)
    .toLowerCase();

  return {
    day: daySchema.parse(weekday),
    time: `${parts.get('hour') ?? ''}:${parts.get('minute') ?? ''}`,
  };
}

/**
 * The weekend is a fact about India, not about the server. 19:00 UTC on a
 * Friday is already Saturday in Bengaluru, and that is when the weekend
 * modifier should start applying.
 */
export const isWeekendInIST = (at: Date): boolean => WEEKEND_DAYS.includes(istMoment(at).day);

/**
 * Windows are half-open: open at `from`, closed at `to`. Two adjacent windows
 * therefore cannot both match the same instant, and a window ending at 11:00
 * covers 10:59 and not 11:00.
 */
export function isWithinPeakWindow(at: Date, windows: readonly PeakWindow[]): boolean {
  const { day, time } = istMoment(at);
  return windows.some(
    (window) => window.days.includes(day) && time >= window.from && time < window.to,
  );
}

/**
 * A documented stub. It always returns false.
 *
 * There is no holiday or event calendar anywhere in this codebase — no table,
 * no feed, no admin surface that declares a date, and nothing in task 10 that
 * creates one. The event modifier is x1.2, so answering from an invented source
 * would move real prices on days nobody chose, which is worse than not
 * answering at all.
 *
 * The signature is the seam. When a calendar lands — an admin-editable
 * `surge_event_days` table alongside `surge_zone_overrides` is the obvious
 * shape, with the same audit trail — only this body changes. The calculator
 * already takes the flag and is already tested against it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const isHolidayOrEvent = (at: Date): boolean => false;

/**
 * Measure occupancy per zone, price each zone from DB-backed config, and write
 * every result in one Redis `MULTI` — so 400 zones is one round trip, not 400.
 *
 * Idempotent by nature (R-ASYNC-03): it recomputes from current state and
 * overwrites. Running it twice in the same minute produces the same keys with
 * the same values, so at-least-once delivery costs nothing but a round trip.
 *
 * No transaction is open across the Redis call (R-BE-04): both reads complete
 * before the pipeline is built, and Redis is a cache — nothing whose loss costs
 * money goes in it (ADR-010). Losing this key costs surge revenue and leaves
 * every search and booking working at base price.
 *
 * `now` is a parameter so the peak-window and weekend determination is testable
 * without a clock library; the scheduled handler passes nothing.
 */
export async function recalculateSurge(deps: JobDeps, now = new Date()): Promise<void> {
  const { global, byZone } = await resolveSurgeConfig(deps);
  const zones = await measureZoneOccupancy(deps, global.occupancyWindowMinutes);

  if (zones.length === 0) {
    logger.info('surge recalculated: no zone has an active listing');
    return;
  }

  const isWeekend = isWeekendInIST(now);
  const holidayOrEvent = isHolidayOrEvent(now);
  const calculatedAt = now.toISOString();

  const pipeline = deps.redis.multi();
  let zonesSurging = 0;

  for (const zone of zones) {
    const config = byZone.get(zone.zoneId) ?? global;

    const result = calculateSurge({
      occupiedSlots: zone.occupiedSlots,
      totalSlots: zone.totalSlots,
      isPeakHour: isWithinPeakWindow(now, config.peakWindows),
      isWeekend,
      isHolidayOrEvent: holidayOrEvent,
      config,
    });

    if (result.multiplierBp > NO_SURGE_BP) zonesSurging += 1;

    const snapshot: SurgeSnapshot = {
      multiplierBp: result.multiplierBp,
      badge: result.badge,
      occupancyBp: result.occupancyBp,
      appliedModifiers: [...result.appliedModifiers],
      calculatedAt,
    };

    pipeline.set(surgeKey(zone.zoneId), JSON.stringify(snapshot), 'EX', SURGE_TTL_SECONDS);
  }

  const replies = await pipeline.exec();

  // R-FAIL-01. A null reply means the MULTI was discarded and not one zone was
  // priced; a reply carrying an error means some were not. Either way the job
  // fails loudly and pg-boss retries it — which is safe precisely because the
  // job is idempotent.
  if (replies === null) {
    throw new Error('surge recalculation MULTI did not execute; no zone was priced');
  }

  const failed = replies.filter(([error]) => error !== null).length;
  if (failed > 0) {
    throw new Error(
      `surge recalculation wrote ${String(zones.length - failed)} of ${String(zones.length)} zones`,
    );
  }

  logger.info({ zonesPriced: zones.length, zonesSurging }, 'surge recalculated');
}
