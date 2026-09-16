import { z } from 'zod';

import { surgeBadgeSchema } from '../enums/surge-badge.js';
import { SURGE_MULTIPLIER_MAX } from '../money/rates.js';

/**
 * Multipliers and occupancy thresholds are integer basis points, not floats.
 *
 * The task file writes these as `numeric(4,2)` and compares `occupancyRate`
 * against `0.60`, but this codebase already stores `bookings.surge_multiplier_bp`
 * as an integer and rates carry the `Bp` suffix (R-MONEY-02). Keeping one
 * representation matters more here than usual: every boundary in the ladder is
 * an exact equality case — "0.60 occupancy is 1.0x, 0.601 is 1.25x" — and float
 * comparison at a tier edge is precisely the class of unexplainable price this
 * task exists to eliminate.
 */
export const BASIS_POINTS = 10_000;

/** 1.0x. Below the first occupancy threshold this is the whole answer. */
export const NO_SURGE_BP = BASIS_POINTS;

/**
 * The ceiling, derived from `rates.ts` rather than retyped here (R-MONEY-03).
 *
 * This file originally carried its own `5 * BASIS_POINTS`, which disagreed with
 * `SURGE_MULTIPLIER_MAX`. The gap was reachable entirely through the supported
 * admin API: a 4x zone override passed every admin-side validation, the worker
 * wrote it to Redis, and then `parkEaseFee` threw a `RangeError` on the next
 * booking in that zone — a 500 on the payment path, and separately a search
 * response that would not serialise. Three schemas have to agree on what a
 * valid multiplier is, so exactly one of them gets to define it.
 */
export const MAX_SURGE_MULTIPLIER_BP = SURGE_MULTIPLIER_MAX * BASIS_POINTS;

export const SURGE_MODIFIER_VALUES = ['peak_hour', 'weekend', 'event'] as const;
export const surgeModifierSchema = z.enum(SURGE_MODIFIER_VALUES);
export type SurgeModifier = z.infer<typeof surgeModifierSchema>;

export const SurgeModifier = {
  PEAK_HOUR: 'peak_hour',
  WEEKEND: 'weekend',
  EVENT: 'event',
} as const satisfies Record<string, SurgeModifier>;

export const surgeTierSchema = z.object({
  minOccupancyBp: z.number().int().min(0).max(BASIS_POINTS),
  multiplierBp: z.number().int().min(NO_SURGE_BP).max(MAX_SURGE_MULTIPLIER_BP),
  badge: surgeBadgeSchema.nullable(),
});
export type SurgeTier = z.infer<typeof surgeTierSchema>;

const isStrictlyAscending = (values: readonly number[]): boolean =>
  values.every((value, i) => i === 0 || value > (values[i - 1] ?? Number.NEGATIVE_INFINITY));

/**
 * There are three badges, so a ladder is a 1.0x floor plus a tier per badge —
 * four rows, as seeded. Finer occupancy granularity that reuses a badge is
 * legitimate (an airport cell adding a 2.5x `very_high_demand` row is the
 * worked example in the task file), so the bound is generous rather than tight.
 *
 * It exists because the calculator scans the ladder linearly for every zone on
 * every five-minute run, and the global ladder applies to every zone without an
 * override. Unbounded here means one admin request sets recurring work for the
 * whole platform. Every other field in this schema is bounded; these two arrays
 * were the exception, which is the only reason they needed saying out loud.
 */
export const MAX_SURGE_TIERS = 12;

/** Seven days, and no day has more than a few distinct bands worth naming. */
export const MAX_PEAK_WINDOWS = 24;

export const surgeTierLadderSchema = z
  .array(surgeTierSchema)
  .min(2)
  .max(MAX_SURGE_TIERS)
  .refine((tiers) => tiers[0]?.minOccupancyBp === 0 && tiers[0]?.multiplierBp === NO_SURGE_BP, {
    message: 'The ladder must start at occupancy 0 with a 1.0x floor',
  })
  .refine((tiers) => isStrictlyAscending(tiers.map((t) => t.minOccupancyBp)), {
    message: 'Tier thresholds must ascend',
  })
  .refine((tiers) => isStrictlyAscending(tiers.map((t) => t.multiplierBp)), {
    message: 'Tier multipliers must ascend with occupancy',
  })
  .refine((tiers) => tiers.every((t) => t.multiplierBp === NO_SURGE_BP || t.badge !== null), {
    // A multiplier above 1.0 with no badge is a price the product cannot explain.
    // This is the schema-level guard against reintroducing v1's bare multipliers.
    message: 'Every surge tier above 1.0x needs a badge',
  });

/**
 * prd.md §8. Thresholds are strictly-greater-than, so exactly 0.60 is 1.0x.
 *
 * Not `readonly`: it is assigned straight into a `SurgeConfig`, whose `tiers`
 * is the mutable array Zod infers. Callers parse or spread it rather than
 * holding this reference, so a shared mutable array is not a live hazard.
 */
export const DEFAULT_SURGE_TIERS: SurgeTier[] = [
  { minOccupancyBp: 0, multiplierBp: 10_000, badge: null },
  { minOccupancyBp: 6_000, multiplierBp: 12_500, badge: 'moderate_demand' },
  { minOccupancyBp: 7_500, multiplierBp: 15_000, badge: 'high_demand' },
  { minOccupancyBp: 9_000, multiplierBp: 20_000, badge: 'very_high_demand' },
];

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DAY_VALUES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const daySchema = z.enum(DAY_VALUES);
export type Day = z.infer<typeof daySchema>;

export const peakWindowSchema = z
  .object({
    days: z.array(daySchema).min(1),
    from: z.string().regex(CLOCK_TIME, 'Peak window times are HH:MM in 24-hour IST'),
    to: z.string().regex(CLOCK_TIME, 'Peak window times are HH:MM in 24-hour IST'),
  })
  .refine((w) => w.to > w.from, {
    message: 'A peak window must end after it starts; split a window that crosses midnight',
  });
export type PeakWindow = z.infer<typeof peakWindowSchema>;

/** Modifiers escalate an existing surge. A modifier below 1.0x would discount. */
const modifierBpSchema = z
  .number()
  .int()
  .min(NO_SURGE_BP)
  .max(2 * BASIS_POINTS);

const surgeConfigShape = {
  maxMultiplierBp: z.number().int().min(NO_SURGE_BP).max(MAX_SURGE_MULTIPLIER_BP),
  peakHourModifierBp: modifierBpSchema,
  weekendModifierBp: modifierBpSchema,
  eventModifierBp: modifierBpSchema,
  occupancyWindowMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  peakWindows: z.array(peakWindowSchema).max(MAX_PEAK_WINDOWS),
  tiers: surgeTierLadderSchema,
};

/**
 * A cap no tier can reach would emit an undocumented multiplier the moment the
 * calculator capped anything against it, so the cap must itself be a tier value.
 */
const capIsReachable = (c: { maxMultiplierBp: number; tiers: readonly SurgeTier[] }): boolean =>
  c.tiers.some((t) => t.multiplierBp === c.maxMultiplierBp);

export const surgeConfigSchema = z.object(surgeConfigShape).refine(capIsReachable, {
  message: 'maxMultiplierBp must equal one of the tier multipliers',
  path: ['maxMultiplierBp'],
});
export type SurgeConfig = z.infer<typeof surgeConfigSchema>;

/**
 * Surge zones are geohash cells, and this is the one place the precision is
 * stated. Precision 6 is ~1.22km x 0.61km, matching the intended 1-2km zone;
 * precision 5 is ~4.9km x 4.9km, roughly sixteen times the area, which averaged
 * a blocked street together with a half-empty neighbourhood and produced no
 * surge for either.
 *
 * It lives in contracts because three separate places have to agree on it and
 * two of them are different deployables: the API's `zoneIdFor`, the worker's
 * `ST_GeoHash(location, N)`, and the zone id regex below. They each used to
 * declare their own `6`. All three were correct, and nothing would have caught
 * it if one had changed — a mismatch means every zone lookup misses, so surge
 * simply never appears, with no error anywhere to explain why.
 *
 * Changing this re-partitions every zone and invalidates every override, so it
 * is a migration with an admin communication, not an edit.
 */
export const ZONE_GEOHASH_PRECISION = 6;

/** Lowercase geohash base32, exactly `ZONE_GEOHASH_PRECISION` characters. */
export const zoneIdSchema = z
  .string()
  .regex(
    new RegExp(`^[0-9bcdefghjkmnpqrstuvwxyz]{${String(ZONE_GEOHASH_PRECISION)}}$`),
    `Not a geohash-${String(ZONE_GEOHASH_PRECISION)} zone`,
  );
export type ZoneId = z.infer<typeof zoneIdSchema>;

/**
 * Every field but the identity trio is optional: a zone can raise its cap
 * without restating the whole ladder. The override's cap wins even when it
 * exceeds the global one — that is the entire point of an override — so a
 * raised cap must arrive with a ladder that reaches it.
 */
export const surgeZoneOverrideInputSchema = z
  .object({
    zoneId: zoneIdSchema,
    label: z.string().min(1).max(120),
    reason: z.string().min(1).max(500),
    enabled: z.boolean().optional(),
    maxMultiplierBp: surgeConfigShape.maxMultiplierBp.optional(),
    peakHourModifierBp: modifierBpSchema.optional(),
    weekendModifierBp: modifierBpSchema.optional(),
    eventModifierBp: modifierBpSchema.optional(),
    tiers: surgeTierLadderSchema.optional(),
  })
  .refine(
    (o) =>
      o.maxMultiplierBp === undefined ||
      o.maxMultiplierBp === NO_SURGE_BP ||
      (o.tiers !== undefined &&
        capIsReachable({ maxMultiplierBp: o.maxMultiplierBp, tiers: o.tiers })),
    {
      message:
        'A raised cap needs a tier ladder containing it — an operator cannot create a reachable multiplier the app has no words for',
      path: ['maxMultiplierBp'],
    },
  );
export type SurgeZoneOverrideInput = z.infer<typeof surgeZoneOverrideInputSchema>;

export const surgeZoneOverridePatchSchema = surgeZoneOverrideInputSchema
  .innerType()
  .partial()
  .omit({ zoneId: true })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'An empty patch changes nothing' });
export type SurgeZoneOverridePatch = z.infer<typeof surgeZoneOverridePatchSchema>;

/**
 * What the worker writes to `surge:{zoneId}` and the API reads back. It is
 * cached data crossing a process boundary, so it parses rather than casts
 * (R-VAL-01), and the badge invariant is asserted here too: a surging snapshot
 * with no badge is corrupt, and corrupt means no surge.
 */
export const surgeSnapshotSchema = z
  .object({
    multiplierBp: z.number().int().min(NO_SURGE_BP).max(MAX_SURGE_MULTIPLIER_BP),
    badge: surgeBadgeSchema.nullable(),
    occupancyBp: z.number().int().min(0).max(BASIS_POINTS),
    appliedModifiers: z.array(surgeModifierSchema),
    calculatedAt: z.string().datetime().nullable(),
  })
  .refine((s) => s.multiplierBp === NO_SURGE_BP || s.badge !== null, {
    message: 'A surging snapshot must name its tier',
    path: ['badge'],
  });
export type SurgeSnapshot = z.infer<typeof surgeSnapshotSchema>;

export const NO_SURGE_SNAPSHOT: SurgeSnapshot = {
  multiplierBp: NO_SURGE_BP,
  badge: null,
  occupancyBp: 0,
  appliedModifiers: [],
  calculatedAt: null,
};
