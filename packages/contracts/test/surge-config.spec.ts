import { describe, expect, it } from 'vitest';

import {
  BASIS_POINTS,
  DEFAULT_SURGE_TIERS,
  MAX_SURGE_TIERS,
  surgeConfigSchema,
  surgeSnapshotSchema,
  surgeTierLadderSchema,
  surgeZoneOverrideInputSchema,
} from '../src/admin/surge-config.js';
import { SurgeBadge } from '../src/enums/index.js';
import { SURGE_MULTIPLIER_MAX } from '../src/money/rates.js';

const floor = { minOccupancyBp: 0, multiplierBp: 10_000, badge: null };

describe('surgeTierLadderSchema', () => {
  it('accepts the default ladder from prd.md §8', () => {
    expect(surgeTierLadderSchema.parse(DEFAULT_SURGE_TIERS)).toHaveLength(4);
  });

  it('rejects a ladder that does not start at occupancy 0 with a 1.0x floor', () => {
    expect(
      surgeTierLadderSchema.safeParse([
        { minOccupancyBp: 1000, multiplierBp: 10_000, badge: null },
        { minOccupancyBp: 6000, multiplierBp: 12_500, badge: SurgeBadge.MODERATE_DEMAND },
      ]).success,
    ).toBe(false);

    expect(
      surgeTierLadderSchema.safeParse([
        { minOccupancyBp: 0, multiplierBp: 11_000, badge: SurgeBadge.MODERATE_DEMAND },
        { minOccupancyBp: 6000, multiplierBp: 12_500, badge: SurgeBadge.MODERATE_DEMAND },
      ]).success,
    ).toBe(false);
  });

  it('rejects thresholds that do not ascend', () => {
    expect(
      surgeTierLadderSchema.safeParse([
        floor,
        { minOccupancyBp: 7500, multiplierBp: 12_500, badge: SurgeBadge.MODERATE_DEMAND },
        { minOccupancyBp: 6000, multiplierBp: 15_000, badge: SurgeBadge.HIGH_DEMAND },
      ]).success,
    ).toBe(false);
  });

  it('rejects multipliers that do not ascend with occupancy', () => {
    expect(
      surgeTierLadderSchema.safeParse([
        floor,
        { minOccupancyBp: 6000, multiplierBp: 15_000, badge: SurgeBadge.HIGH_DEMAND },
        { minOccupancyBp: 7500, multiplierBp: 12_500, badge: SurgeBadge.MODERATE_DEMAND },
      ]).success,
    ).toBe(false);
  });

  it('rejects a surging tier with no badge — an unexplainable price', () => {
    expect(
      surgeTierLadderSchema.safeParse([
        floor,
        { minOccupancyBp: 6000, multiplierBp: 12_500, badge: null },
      ]).success,
    ).toBe(false);
  });

  it('rejects a ladder of fewer than two tiers', () => {
    expect(surgeTierLadderSchema.safeParse([floor]).success).toBe(false);
  });

  it('bounds the ladder, so one admin request cannot set unbounded recurring work', () => {
    // The calculator scans the ladder linearly per zone per five-minute run, and
    // the global ladder applies to every zone without an override. Every other
    // field in this schema is bounded; this one was the exception.
    const ladderOf = (count: number) =>
      Array.from({ length: count }, (_unused, i) =>
        i === 0
          ? floor
          : {
              minOccupancyBp: i * 100,
              multiplierBp: 10_000 + i * 100,
              badge: SurgeBadge.MODERATE_DEMAND,
            },
      );

    expect(surgeTierLadderSchema.safeParse(ladderOf(MAX_SURGE_TIERS)).success).toBe(true);
    expect(surgeTierLadderSchema.safeParse(ladderOf(MAX_SURGE_TIERS + 1)).success).toBe(false);
  });
});

describe('the config ceiling agrees with the money ceiling', () => {
  // These three schemas must agree on "what is a valid surge multiplier", and
  // for a while they did not: this file allowed 5.0x while rates.ts capped the
  // money path at 3.0x. An admin configuring a 4x airport override passed every
  // admin-side validation, the worker wrote it to Redis, and then parkEaseFee
  // threw a RangeError on the next booking in that zone — a 500 on the payment
  // path, produced entirely through the supported admin API.
  const ceilingBp = SURGE_MULTIPLIER_MAX * BASIS_POINTS;

  const ladderTo = (multiplierBp: number) => [
    { minOccupancyBp: 0, multiplierBp: 10_000, badge: null },
    { minOccupancyBp: 9_000, multiplierBp: multiplierBp, badge: SurgeBadge.VERY_HIGH_DEMAND },
  ];

  it('accepts a ladder reaching exactly the money ceiling', () => {
    expect(surgeTierLadderSchema.safeParse(ladderTo(ceilingBp)).success).toBe(true);
  });

  it('rejects a tier above the ceiling parkEaseFee would throw on', () => {
    expect(surgeTierLadderSchema.safeParse(ladderTo(ceilingBp + 100)).success).toBe(false);
  });

  it('rejects a cap above the ceiling, whatever the ladder says', () => {
    expect(
      surgeConfigSchema.safeParse({
        maxMultiplierBp: ceilingBp + 100,
        peakHourModifierBp: 11_000,
        weekendModifierBp: 10_500,
        eventModifierBp: 12_000,
        occupancyWindowMinutes: 60,
        peakWindows: [],
        tiers: ladderTo(ceilingBp + 100),
      }).success,
    ).toBe(false);
  });

  it('rejects a zone override cap above the ceiling', () => {
    expect(
      surgeZoneOverrideInputSchema.safeParse({
        zoneId: 'tdr1v0',
        label: 'Airport',
        reason: 'Structural scarcity',
        maxMultiplierBp: ceilingBp + 100,
        tiers: ladderTo(ceilingBp + 100),
      }).success,
    ).toBe(false);
  });
});

describe('surgeConfigSchema', () => {
  const base = {
    maxMultiplierBp: 20_000,
    peakHourModifierBp: 11_000,
    weekendModifierBp: 10_500,
    eventModifierBp: 12_000,
    occupancyWindowMinutes: 60,
    peakWindows: [{ days: ['mon'], from: '08:00', to: '11:00' }],
    tiers: DEFAULT_SURGE_TIERS,
  };

  it('accepts the seeded global configuration', () => {
    expect(surgeConfigSchema.parse(base).maxMultiplierBp).toBe(20_000);
  });

  it('rejects a cap no tier can reach', () => {
    expect(surgeConfigSchema.safeParse({ ...base, maxMultiplierBp: 17_500 }).success).toBe(false);
  });

  it('rejects a modifier below 1.0x — modifiers escalate, they never discount', () => {
    expect(surgeConfigSchema.safeParse({ ...base, weekendModifierBp: 9_000 }).success).toBe(false);
  });

  it('rejects a peak window whose end is not after its start', () => {
    expect(
      surgeConfigSchema.safeParse({
        ...base,
        peakWindows: [{ days: ['mon'], from: '11:00', to: '08:00' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed clock time', () => {
    expect(
      surgeConfigSchema.safeParse({
        ...base,
        peakWindows: [{ days: ['mon'], from: '8:00', to: '11:00' }],
      }).success,
    ).toBe(false);
  });
});

describe('surgeZoneOverrideInputSchema', () => {
  const override = {
    zoneId: 'tdr1v0',
    label: 'Kempegowda airport approach',
    reason: 'Structural scarcity; airport parking is 4x our rate',
  };

  it('accepts a partial override that raises only the cap, when a tier reaches it', () => {
    const parsed = surgeZoneOverrideInputSchema.parse({
      ...override,
      maxMultiplierBp: 25_000,
      tiers: [
        ...DEFAULT_SURGE_TIERS,
        { minOccupancyBp: 9500, multiplierBp: 25_000, badge: SurgeBadge.VERY_HIGH_DEMAND },
      ],
    });
    expect(parsed.maxMultiplierBp).toBe(25_000);
  });

  it('rejects a raised cap with no tier that reaches it', () => {
    expect(
      surgeZoneOverrideInputSchema.safeParse({ ...override, maxMultiplierBp: 25_000 }).success,
    ).toBe(false);
  });

  it('accepts a cap of 1.0x, which disables surge for the zone', () => {
    expect(
      surgeZoneOverrideInputSchema.safeParse({ ...override, maxMultiplierBp: 10_000 }).success,
    ).toBe(true);
  });

  it('rejects a zone id that is not a geohash-6 cell', () => {
    expect(surgeZoneOverrideInputSchema.safeParse({ ...override, zoneId: 'tdr1v' }).success).toBe(
      false,
    );
    expect(surgeZoneOverrideInputSchema.safeParse({ ...override, zoneId: 'TDR1V0' }).success).toBe(
      false,
    );
    expect(surgeZoneOverrideInputSchema.safeParse({ ...override, zoneId: 'tdr1va' }).success).toBe(
      false,
    );
  });

  it('requires a reason — a price change nobody can account for is the bug', () => {
    expect(surgeZoneOverrideInputSchema.safeParse({ ...override, reason: '' }).success).toBe(false);
  });
});

describe('surgeSnapshotSchema', () => {
  it('parses what the worker writes', () => {
    const snapshot = surgeSnapshotSchema.parse({
      multiplierBp: 15_000,
      badge: 'high_demand',
      occupancyBp: 8000,
      appliedModifiers: ['peak_hour'],
      calculatedAt: '2026-09-06T10:00:04.118Z',
    });
    expect(snapshot.multiplierBp).toBe(15_000);
  });

  it('rejects a multiplier outside the contract range', () => {
    expect(
      surgeSnapshotSchema.safeParse({
        multiplierBp: 90_000,
        badge: 'high_demand',
        occupancyBp: 8000,
        appliedModifiers: [],
        calculatedAt: '2026-09-06T10:00:04.118Z',
      }).success,
    ).toBe(false);
  });

  it('rejects a surging snapshot with no badge', () => {
    expect(
      surgeSnapshotSchema.safeParse({
        multiplierBp: 15_000,
        badge: null,
        occupancyBp: 8000,
        appliedModifiers: [],
        calculatedAt: '2026-09-06T10:00:04.118Z',
      }).success,
    ).toBe(false);
  });
});
