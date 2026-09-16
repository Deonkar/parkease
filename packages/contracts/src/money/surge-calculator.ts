import {
  BASIS_POINTS,
  NO_SURGE_BP,
  type SurgeConfig,
  type SurgeModifier,
  type SurgeTier,
} from '../admin/surge-config.js';
import type { SurgeBadge } from '../enums/surge-badge.js';

/**
 * The surge calculator, as a pure function of occupancy and configuration.
 *
 * It lives in `contracts` rather than in `apps/api/src/domains/surge/` for the
 * same reason `assertEntriesBalance` does: `apps/worker` is a separate
 * deployable with no Nest container, and it is the worker that runs this every
 * five minutes. The task file puts it under `domains/surge/`, but that would
 * force the worker to either import from another app or keep a second copy of
 * the rule that decides every price on the platform. One copy, reachable from
 * both, is the existing precedent (`apps/worker/src/jobs/booking/ledger.ts`).
 *
 * Nothing here reads a clock, a database or an environment variable. Every
 * input arrives as an argument, which is what makes the 80,008-case sweep in
 * `test/surge-calculator.spec.ts` cheap enough to run on every commit.
 */

export interface SurgeOccupancy {
  /** Slot-instances held over the measurement window, not spaces. */
  readonly occupiedSlots: number;
  /** Bookable slot-instances in the zone. Zero means the zone has no listings. */
  readonly totalSlots: number;
}

export interface SurgeInput extends SurgeOccupancy {
  readonly isPeakHour: boolean;
  readonly isWeekend: boolean;
  readonly isHolidayOrEvent: boolean;
  /** Global config, already merged with any enabled zone override. */
  readonly config: SurgeConfig;
}

export interface SurgeResult {
  readonly multiplierBp: number;
  readonly badge: SurgeBadge | null;
  readonly occupancyBp: number;
  readonly appliedModifiers: readonly SurgeModifier[];
}

/**
 * Occupancy as basis points, computed from the counts rather than from a
 * pre-divided rate. `3/4` is 7500 exactly here; `0.75` arrived at by float
 * division and then compared against a float threshold is how a tier boundary
 * becomes a coin toss.
 */
export function occupancyBpOf(occupancy: SurgeOccupancy): number {
  if (occupancy.totalSlots <= 0) return 0;
  return Math.round((occupancy.occupiedSlots * BASIS_POINTS) / occupancy.totalSlots);
}

export function calculateSurge(input: SurgeInput): SurgeResult {
  const { config } = input;
  const ladder = config.tiers;
  const occupancyBp = occupancyBpOf(input);

  const baseTier = tierForOccupancy(input, ladder);

  // Modifiers escalate an existing surge. They never create one.
  //
  // v1 applied them unconditionally, so a quiet Saturday returned 1.05x and a
  // quiet Saturday evening returned 1.155x — multipliers with no tier, no badge
  // and no copy. At or below the first occupancy threshold the answer is 1.0x.
  if (baseTier.multiplierBp === NO_SURGE_BP) {
    return { multiplierBp: NO_SURGE_BP, badge: null, occupancyBp, appliedModifiers: [] };
  }

  const appliedModifiers: SurgeModifier[] = [];
  let escalatedBp = baseTier.multiplierBp;

  if (input.isPeakHour) {
    escalatedBp = applyModifier(escalatedBp, config.peakHourModifierBp);
    appliedModifiers.push('peak_hour');
  }
  if (input.isWeekend) {
    escalatedBp = applyModifier(escalatedBp, config.weekendModifierBp);
    appliedModifiers.push('weekend');
  }
  if (input.isHolidayOrEvent) {
    escalatedBp = applyModifier(escalatedBp, config.eventModifierBp);
    appliedModifiers.push('event');
  }

  const cappedBp = Math.min(escalatedBp, config.maxMultiplierBp);

  // Snap DOWN to the highest tier at or below the escalated value, and never
  // below the tier occupancy alone already earned. This is what guarantees the
  // output is always a value the product has a badge and a price line for —
  // and snapping down rather than to the nearest means a driver is never
  // charged above the tier the demand actually reached.
  const finalTier = snapDownToTier(cappedBp, baseTier, ladder);

  // A cap below the base tier (a zone disabled at 1.0x) snaps to the floor,
  // where the badge must go too — a 1.0x price with a "high demand" chip is
  // exactly the unexplainable pairing the ladder schema forbids.
  return {
    multiplierBp: finalTier.multiplierBp,
    badge: finalTier.multiplierBp === NO_SURGE_BP ? null : finalTier.badge,
    occupancyBp,
    appliedModifiers: finalTier.multiplierBp === NO_SURGE_BP ? [] : appliedModifiers,
  };
}

const applyModifier = (multiplierBp: number, modifierBp: number): number =>
  Math.round((multiplierBp * modifierBp) / BASIS_POINTS);

function tierForOccupancy(occupancy: SurgeOccupancy, ladder: readonly SurgeTier[]): SurgeTier {
  const floor = ladder[0] as SurgeTier;
  let match = floor;

  for (const tier of ladder) {
    // `occupied / total > minOccupancy` without the division: exact integer
    // comparison, so "exactly 0.60 occupancy" is decided rather than rounded.
    if (occupancy.occupiedSlots * BASIS_POINTS > tier.minOccupancyBp * occupancy.totalSlots) {
      match = tier;
    }
  }

  return match;
}

function snapDownToTier(
  valueBp: number,
  floor: SurgeTier,
  ladder: readonly SurgeTier[],
): SurgeTier {
  // A cap below the base tier has to win, or a zone disabled at 1.0x would
  // still surge. Start from the lowest tier at or below the value instead.
  if (valueBp < floor.multiplierBp) {
    let belowFloor = ladder[0] as SurgeTier;
    for (const tier of ladder) {
      if (tier.multiplierBp <= valueBp) belowFloor = tier;
    }
    return belowFloor;
  }

  let match = floor;
  for (const tier of ladder) {
    if (tier.multiplierBp <= valueBp && tier.multiplierBp >= floor.multiplierBp) match = tier;
  }
  return match;
}
