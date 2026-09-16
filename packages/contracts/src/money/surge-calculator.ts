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

  // Snap DOWN to the highest tier at or below the escalated value. This is what
  // guarantees the output is always a value the product has a badge and a price
  // line for — and snapping down rather than to the nearest means a driver is
  // never charged above the tier the demand actually reached.
  const finalTier = snapDownToTier(cappedBp, ladder);

  // A cap below the base tier (a zone disabled at 1.0x) snaps back to the
  // floor, and the badge and the modifier list have to follow it down: a 1.0x
  // price wearing a "high demand" chip is exactly the unexplainable pairing the
  // ladder schema forbids.
  const noSurge = finalTier.multiplierBp === NO_SURGE_BP;

  return {
    multiplierBp: finalTier.multiplierBp,
    badge: noSurge ? null : finalTier.badge,
    occupancyBp,
    appliedModifiers: noSurge ? [] : appliedModifiers,
  };
}

const applyModifier = (multiplierBp: number, modifierBp: number): number =>
  Math.round((multiplierBp * modifierBp) / BASIS_POINTS);

function tierForOccupancy(occupancy: SurgeOccupancy, ladder: readonly SurgeTier[]): SurgeTier {
  const floor = ladder[0] as SurgeTier;

  // A zone with no bookable slots is empty, not full.
  //
  // Without this, multiplying by `totalSlots === 0` zeroes the right-hand side
  // of every comparison below, so `occupiedSlots * 10000 > 0` holds for every
  // tier and the last write wins — the top of the ladder. The function would
  // return 2.0x `very_high_demand` while `occupancyBpOf` reported 0% for the
  // same input, which is the two halves of this file disagreeing about what a
  // listing-less zone means. `occupancyBpOf` already guards it; this is the
  // other half of the same guard.
  //
  // The worker cannot currently produce such a row — the occupancy SQL groups
  // over rows that exist and `zoneRowSchema` requires a positive total — but
  // this function is exported for both deployables and its own docstring calls
  // `totalSlots: 0` a valid input meaning "the zone has no listings". A public
  // function that contradicts its own contract is a defect waiting for a
  // second caller.
  if (occupancy.totalSlots <= 0) return floor;

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

/**
 * The highest tier at or below `valueBp` — one loop, no special case.
 *
 * This used to branch on whether the value had fallen below the tier occupancy
 * alone earned (a zone capped at 1.0x), on the reasoning that the cap has to
 * win or a disabled zone would still surge. The branch was real but redundant:
 * the ladder is schema-enforced ascending and starts at the 1.0x floor, and
 * `valueBp` can never fall below that floor because `maxMultiplierBp`'s own
 * minimum is `NO_SURGE_BP`. So "the highest tier at or below the value" already
 * describes both cases, and taking the last match over an ascending ladder
 * finds it either way.
 */
function snapDownToTier(valueBp: number, ladder: readonly SurgeTier[]): SurgeTier {
  let match = ladder[0] as SurgeTier;
  for (const tier of ladder) {
    if (tier.multiplierBp <= valueBp) match = tier;
  }
  return match;
}
