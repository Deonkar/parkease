import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SURGE_TIERS,
  NO_SURGE_BP,
  type SurgeConfig,
  SurgeModifier,
  type SurgeTier,
} from '../src/admin/surge-config.js';
import { calculateSurge, occupancyBpOf } from '../src/money/surge-calculator.js';

const config: SurgeConfig = {
  maxMultiplierBp: 20_000,
  peakHourModifierBp: 11_000,
  weekendModifierBp: 10_500,
  eventModifierBp: 12_000,
  occupancyWindowMinutes: 60,
  peakWindows: [],
  tiers: DEFAULT_SURGE_TIERS,
};

const quiet = { isPeakHour: false, isWeekend: false, isHolidayOrEvent: false };
const allModifiers = { isPeakHour: true, isWeekend: true, isHolidayOrEvent: true };

/** Occupancy is expressed as a held/total pair so no boundary is ever a float. */
const at = (occupancyBp: number) => ({ occupiedSlots: occupancyBp, totalSlots: 10_000 });

describe('occupancyBpOf', () => {
  it('is exact for the slot counts a real zone produces', () => {
    expect(occupancyBpOf({ occupiedSlots: 8, totalSlots: 10 })).toBe(8_000);
    expect(occupancyBpOf({ occupiedSlots: 3, totalSlots: 4 })).toBe(7_500);
    expect(occupancyBpOf({ occupiedSlots: 0, totalSlots: 12 })).toBe(0);
    expect(occupancyBpOf({ occupiedSlots: 12, totalSlots: 12 })).toBe(10_000);
  });

  it('treats a zone with no bookable slots as empty rather than dividing by zero', () => {
    expect(occupancyBpOf({ occupiedSlots: 0, totalSlots: 0 })).toBe(0);
  });
});

describe('calculateSurge — the occupancy ladder', () => {
  const cases: ReadonlyArray<readonly [number, number, string | null]> = [
    [0, 10_000, null],
    [3_000, 10_000, null],
    [5_990, 10_000, null],
    [6_000, 10_000, null], // exactly 0.60 is 1.0x — thresholds are strictly greater than
    [6_010, 12_500, 'moderate_demand'],
    [7_400, 12_500, 'moderate_demand'],
    [7_500, 12_500, 'moderate_demand'], // exactly 0.75 stays at the lower tier
    [7_510, 15_000, 'high_demand'],
    [8_900, 15_000, 'high_demand'],
    [9_000, 15_000, 'high_demand'], // exactly 0.90 stays at the lower tier
    [9_010, 20_000, 'very_high_demand'],
    [10_000, 20_000, 'very_high_demand'],
  ];

  it.each(cases)('occupancy %i bp gives %i bp', (occupancyBp, multiplierBp, badge) => {
    const result = calculateSurge({ ...at(occupancyBp), ...quiet, config });
    expect(result.multiplierBp).toBe(multiplierBp);
    expect(result.badge).toBe(badge);
  });
});

describe('calculateSurge — modifiers never fire at the floor', () => {
  // The regression suite for v1's central bug: a quiet Saturday evening
  // returned 1.155x, a multiplier with no tier, no badge and no copy.
  const cases: ReadonlyArray<readonly [number, Partial<typeof allModifiers>]> = [
    [2_000, { isPeakHour: true }],
    [2_000, { isWeekend: true }],
    [2_000, { isPeakHour: true, isWeekend: true }],
    [2_000, allModifiers],
    [5_000, allModifiers],
    [6_000, allModifiers],
  ];

  it.each(cases)('occupancy %i bp with modifiers stays at 1.0x', (occupancyBp, modifiers) => {
    const result = calculateSurge({ ...at(occupancyBp), ...quiet, ...modifiers, config });
    expect(result.multiplierBp).toBe(NO_SURGE_BP);
    expect(result.badge).toBeNull();
    expect(result.appliedModifiers).toEqual([]);
  });
});

describe('calculateSurge — modifiers above the floor', () => {
  it('leaves a tier alone when the escalation does not cross the next one', () => {
    expect(calculateSurge({ ...at(7_000), ...quiet, isWeekend: true, config }).multiplierBp).toBe(
      12_500,
    );
    expect(calculateSurge({ ...at(8_000), ...quiet, isWeekend: true, config }).multiplierBp).toBe(
      15_000,
    );
  });

  it('moves a zone up a tier when the combined pressure is large enough', () => {
    const result = calculateSurge({
      ...at(7_000),
      ...quiet,
      isPeakHour: true,
      isHolidayOrEvent: true,
      config,
    });
    expect(result.multiplierBp).toBe(15_000);
    expect(result.badge).toBe('high_demand');
    expect(result.appliedModifiers).toEqual([SurgeModifier.PEAK_HOUR, SurgeModifier.EVENT]);
  });

  it('caps, then snaps down to a real tier', () => {
    // 1.5 x 1.1 x 1.05 x 1.2 = 2.079, capped to 2.0, which is a tier.
    expect(calculateSurge({ ...at(8_000), ...allModifiers, config }).multiplierBp).toBe(20_000);
    // 2.0 x all three = 3.168, capped at the global maximum.
    expect(calculateSurge({ ...at(9_500), ...allModifiers, config }).multiplierBp).toBe(20_000);
  });

  it('records only the modifiers that actually applied', () => {
    const result = calculateSurge({ ...at(7_000), ...quiet, isWeekend: true, config });
    expect(result.appliedModifiers).toEqual([SurgeModifier.WEEKEND]);
  });

  it('never snaps below the tier the occupancy alone earned', () => {
    const result = calculateSurge({ ...at(9_500), ...quiet, config });
    expect(result.multiplierBp).toBe(20_000);
  });
});

describe('calculateSurge — caps and overrides', () => {
  it('honours a zone cap above the global one, when a tier reaches it', () => {
    const airport: SurgeConfig = {
      ...config,
      maxMultiplierBp: 25_000,
      tiers: [
        ...DEFAULT_SURGE_TIERS,
        { minOccupancyBp: 9_500, multiplierBp: 25_000, badge: 'very_high_demand' },
      ],
    };
    expect(calculateSurge({ ...at(9_700), ...quiet, config: airport }).multiplierBp).toBe(25_000);
  });

  it('disables surge for a zone capped at 1.0x', () => {
    const capped: SurgeConfig = { ...config, maxMultiplierBp: NO_SURGE_BP };
    const result = calculateSurge({ ...at(10_000), ...allModifiers, config: capped });
    expect(result.multiplierBp).toBe(NO_SURGE_BP);
    expect(result.badge).toBeNull();
  });

  it('caps to the highest tier at or below the cap, never to the cap itself', () => {
    // A 1.75x cap is not a tier, so a fully-occupied zone lands on 1.5x rather
    // than emitting an undocumented 1.75x.
    const odd: SurgeConfig = { ...config, maxMultiplierBp: 17_500 };
    const result = calculateSurge({ ...at(9_500), ...quiet, config: odd });
    expect(result.multiplierBp).toBe(15_000);
    expect(result.badge).toBe('high_demand');
  });
});

describe('calculateSurge — the invariant that makes all of it safe', () => {
  it('only ever returns a multiplier present in the configured ladder', () => {
    const ladder = new Set(config.tiers.map((t: SurgeTier) => t.multiplierBp));
    const badges = new Map(config.tiers.map((t: SurgeTier) => [t.multiplierBp, t.badge]));

    // Deterministic sweep rather than a seeded RNG: every occupancy basis point
    // from 0 to 10000 crossed with all eight modifier combinations is 80,008
    // cases and covers every boundary exactly, which random sampling does not.
    for (let occupancyBp = 0; occupancyBp <= 10_000; occupancyBp += 1) {
      for (let mask = 0; mask < 8; mask += 1) {
        const result = calculateSurge({
          ...at(occupancyBp),
          isPeakHour: (mask & 1) !== 0,
          isWeekend: (mask & 2) !== 0,
          isHolidayOrEvent: (mask & 4) !== 0,
          config,
        });
        expect(ladder.has(result.multiplierBp)).toBe(true);
        expect(result.badge).toBe(badges.get(result.multiplierBp));
        expect(result.multiplierBp).toBeLessThanOrEqual(config.maxMultiplierBp);
      }
    }
  });
});
