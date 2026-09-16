import {
  DEFAULT_SURGE_TIERS,
  NO_SURGE_BP,
  type SurgeTier,
  type SurgeZoneOverridePatch,
} from '@parkease/contracts/admin';
import { describe, expect, it } from 'vitest';

import {
  applyZoneOverridePatch,
  type StoredZoneOverride,
} from '../src/domains/surge/zone-override-patch.js';

const AIRPORT_CAP_BP = 25_000;
const GLOBAL_CAP_BP = 20_000;
const PEAK_BP = 11_000;

const ladderReaching = (capBp: number): SurgeTier[] => [
  ...DEFAULT_SURGE_TIERS,
  { minOccupancyBp: 9_500, multiplierBp: capBp, badge: 'very_high_demand' },
];

function stored(overrides: Partial<StoredZoneOverride> = {}): StoredZoneOverride {
  return {
    zoneId: 'tdr1v0',
    label: 'Kempegowda Airport approach',
    reason: 'Structural scarcity; airport parking is 4x our rate',
    enabled: true,
    maxMultiplierBp: null,
    peakHourModifierBp: null,
    weekendModifierBp: null,
    eventModifierBp: null,
    tiers: null,
    ...overrides,
  };
}

const patch = (p: SurgeZoneOverridePatch): SurgeZoneOverridePatch => p;

describe('applyZoneOverridePatch', () => {
  it('leaves every untouched field exactly as it was stored', () => {
    const existing = stored({ maxMultiplierBp: GLOBAL_CAP_BP, tiers: DEFAULT_SURGE_TIERS });

    const merged = applyZoneOverridePatch(existing, patch({ label: 'Airport, north gate' }));

    expect(merged.label).toBe('Airport, north gate');
    expect(merged.reason).toBe(existing.reason);
    expect(merged.maxMultiplierBp).toBe(GLOBAL_CAP_BP);
    expect(merged.tiers).toEqual(DEFAULT_SURGE_TIERS);
  });

  it('keeps the zone id — a patch cannot move an override to another cell', () => {
    const merged = applyZoneOverridePatch(stored(), patch({ label: 'Renamed' }));

    expect(merged.zoneId).toBe('tdr1v0');
  });

  it('reports a stored null as an absent override rather than a value', () => {
    // null in the column means "defer to global". It must not reach the schema
    // as a value, or a partial override becomes a full one on first edit.
    const merged = applyZoneOverridePatch(stored(), patch({ reason: 'Still scarce' }));

    expect(merged.maxMultiplierBp).toBeUndefined();
    expect(merged.tiers).toBeUndefined();
    expect(merged.peakHourModifierBp).toBeUndefined();
  });

  it('carries a disable through', () => {
    expect(applyZoneOverridePatch(stored(), patch({ enabled: false })).enabled).toBe(false);
  });

  it('accepts a raised cap when the patch brings a ladder that reaches it', () => {
    const merged = applyZoneOverridePatch(
      stored(),
      patch({ maxMultiplierBp: AIRPORT_CAP_BP, tiers: ladderReaching(AIRPORT_CAP_BP) }),
    );

    expect(merged.maxMultiplierBp).toBe(AIRPORT_CAP_BP);
  });

  it('accepts a raised cap when the ladder that reaches it is already stored', () => {
    // The whole point of a partial patch: raise the cap on a zone whose ladder
    // was set in a previous edit, without restating the ladder.
    const existing = stored({ tiers: ladderReaching(AIRPORT_CAP_BP) });

    const merged = applyZoneOverridePatch(existing, patch({ maxMultiplierBp: AIRPORT_CAP_BP }));

    expect(merged.maxMultiplierBp).toBe(AIRPORT_CAP_BP);
  });

  it('rejects a raised cap that no ladder — stored or patched — reaches', () => {
    // The refinement lives on the whole override, and `.partial()` drops it. A
    // merge that did not re-validate would let an operator raise a cap to a
    // multiplier the app has no words for, one field at a time.
    expect(() =>
      applyZoneOverridePatch(stored(), patch({ maxMultiplierBp: AIRPORT_CAP_BP })),
    ).toThrow();
  });

  it('rejects a ladder swap that strands a stored cap', () => {
    const existing = stored({
      maxMultiplierBp: AIRPORT_CAP_BP,
      tiers: ladderReaching(AIRPORT_CAP_BP),
    });

    expect(() => applyZoneOverridePatch(existing, patch({ tiers: DEFAULT_SURGE_TIERS }))).toThrow();
  });

  it('allows a cap of 1.0x, which disables surge for the zone', () => {
    const merged = applyZoneOverridePatch(stored(), patch({ maxMultiplierBp: NO_SURGE_BP }));

    expect(merged.maxMultiplierBp).toBe(NO_SURGE_BP);
  });

  it('rejects a ladder with a surging tier that has no badge', () => {
    expect(() =>
      applyZoneOverridePatch(
        stored(),
        patch({
          tiers: [
            { minOccupancyBp: 0, multiplierBp: NO_SURGE_BP, badge: null },
            { minOccupancyBp: 6_000, multiplierBp: 12_500, badge: null },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects a ladder whose multipliers do not ascend', () => {
    expect(() =>
      applyZoneOverridePatch(
        stored(),
        patch({
          tiers: [
            { minOccupancyBp: 0, multiplierBp: NO_SURGE_BP, badge: null },
            { minOccupancyBp: 6_000, multiplierBp: 15_000, badge: 'high_demand' },
            { minOccupancyBp: 7_500, multiplierBp: 12_500, badge: 'moderate_demand' },
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects an empty reason', () => {
    expect(() => applyZoneOverridePatch(stored(), patch({ reason: '' }))).toThrow();
  });

  it('carries a modifier patch through and validates its range', () => {
    expect(applyZoneOverridePatch(stored(), patch({ peakHourModifierBp: PEAK_BP })).peakHourModifierBp).toBe(
      PEAK_BP,
    );
    expect(() =>
      applyZoneOverridePatch(stored(), patch({ peakHourModifierBp: NO_SURGE_BP - 1 })),
    ).toThrow();
  });
});
