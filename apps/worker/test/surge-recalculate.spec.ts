import {
  DEFAULT_SURGE_TIERS,
  type PeakWindow,
  type SurgeConfig,
  surgeSnapshotSchema,
  type SurgeTier,
  type ZoneId,
} from '@parkease/contracts/admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeZoneConfig, resolveSurgeConfig } from '../src/jobs/surge/config.js';
import { measureZoneOccupancy } from '../src/jobs/surge/occupancy.js';
import {
  isHolidayOrEvent,
  isWeekendInIST,
  isWithinPeakWindow,
  recalculateSurge,
  SURGE_TTL_SECONDS,
  surgeKey,
} from '../src/jobs/surge/recalculate.job.js';

import { fakeRedis, type RecordedSet } from './fake-redis.js';

vi.mock('../src/jobs/surge/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/jobs/surge/config.js')>();
  return { ...actual, resolveSurgeConfig: vi.fn() };
});
vi.mock('../src/jobs/surge/occupancy.js', () => ({ measureZoneOccupancy: vi.fn() }));

const resolveMock = vi.mocked(resolveSurgeConfig);
const measureMock = vi.mocked(measureZoneOccupancy);

/**
 * The seeded global row from migration 0024, restated. A test that imported the
 * value it is asserting would be guarding its own copy (learnings.md), so these
 * numbers are written out — they are the expectation, not the input.
 */
const GLOBAL: SurgeConfig = {
  maxMultiplierBp: 20_000,
  peakHourModifierBp: 11_000,
  weekendModifierBp: 10_500,
  eventModifierBp: 12_000,
  occupancyWindowMinutes: 60,
  peakWindows: [
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '08:00', to: '11:00' },
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '17:00', to: '21:00' },
  ],
  tiers: DEFAULT_SURGE_TIERS,
};

/** 14:30 IST on Wednesday 16 Sep 2026: no peak window, not a weekend. */
const QUIET_WEDNESDAY = new Date('2026-09-16T09:00:00.000Z');

const depsWith = (redis: { multi: () => unknown }) => ({ db: {}, redis }) as never;

const snapshotAt = (sets: readonly RecordedSet[], zoneId: string) => {
  const written = sets.find((s) => s.key === surgeKey(zoneId as ZoneId));
  if (written === undefined) throw new Error(`no key written for zone ${zoneId}`);
  return surgeSnapshotSchema.parse(JSON.parse(written.value));
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveMock.mockResolvedValue({ global: GLOBAL, byZone: new Map() });
});

describe('surge.recalculate — the Redis write', () => {
  it('writes every zone in exactly one MULTI', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 10, occupiedSlots: 0 },
      { zoneId: 'tdr1v1' as ZoneId, totalSlots: 10, occupiedSlots: 8 },
      { zoneId: 'tdr1v2' as ZoneId, totalSlots: 10, occupiedSlots: 10 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    expect(redis.counts.multi).toBe(1);
    expect(redis.counts.exec).toBe(1);
    expect(redis.sets).toHaveLength(3);
    expect(redis.sets.map((s) => s.key)).toEqual([
      'surge:tdr1v0',
      'surge:tdr1v1',
      'surge:tdr1v2',
    ]);
  });

  it('sets a 600 second TTL on every key', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 4, occupiedSlots: 3 },
      { zoneId: 'tdr1v1' as ZoneId, totalSlots: 4, occupiedSlots: 1 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    expect(SURGE_TTL_SECONDS).toBe(600);
    for (const written of redis.sets) {
      expect(written.mode).toBe('EX');
      expect(written.ttl).toBe(600);
    }
  });

  it('opens no MULTI at all when no zone has an active listing', async () => {
    measureMock.mockResolvedValue([]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    expect(redis.counts.multi).toBe(0);
    expect(redis.sets).toEqual([]);
  });

  it('raises rather than ignores a MULTI that did not execute', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 4, occupiedSlots: 4 },
    ]);
    const redis = fakeRedis({ execReturnsNull: true });

    await expect(recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY)).rejects.toThrow(
      /surge/i,
    );
  });
});

describe('surge.recalculate — what each zone is priced at', () => {
  it('prices a zone with active spaces and no bookings at 1.0x with no badge', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 10, occupiedSlots: 0 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    expect(snapshotAt(redis.sets, 'tdr1v0')).toEqual({
      multiplierBp: 10_000,
      badge: null,
      occupancyBp: 0,
      appliedModifiers: [],
      calculatedAt: QUIET_WEDNESDAY.toISOString(),
    });
  });

  it('measures occupancy per slot-instance: 3 of 4 slots is 7500bp, not 10000', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 4, occupiedSlots: 3 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    const snapshot = snapshotAt(redis.sets, 'tdr1v0');
    expect(snapshot.occupancyBp).toBe(7_500);
    // Exactly 0.75 is the `moderate_demand` tier: thresholds are strictly-greater-than.
    expect(snapshot.multiplierBp).toBe(12_500);
    expect(snapshot.badge).toBe('moderate_demand');
  });

  it('honours a zone override cap that exceeds the global cap', async () => {
    const airportTiers: SurgeTier[] = [
      ...DEFAULT_SURGE_TIERS,
      { minOccupancyBp: 9_500, multiplierBp: 25_000, badge: 'very_high_demand' },
    ];
    resolveMock.mockResolvedValue({
      global: GLOBAL,
      byZone: new Map([
        ['tdr1v0' as ZoneId, { ...GLOBAL, maxMultiplierBp: 25_000, tiers: airportTiers }],
      ]),
    });
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 100, occupiedSlots: 97 },
      { zoneId: 'tdr1v1' as ZoneId, totalSlots: 100, occupiedSlots: 97 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    // v1's hard-coded Math.min(x, 2.0) made this unreachable while the admin
    // screen advertised it.
    expect(snapshotAt(redis.sets, 'tdr1v0').multiplierBp).toBe(25_000);
    // The identical zone under the global config still caps at 2.0x.
    expect(snapshotAt(redis.sets, 'tdr1v1').multiplierBp).toBe(20_000);
  });

  it('produces identical keys and values on two consecutive runs (R-ASYNC-03)', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 10, occupiedSlots: 8 },
      { zoneId: 'tdr1v1' as ZoneId, totalSlots: 10, occupiedSlots: 2 },
    ]);

    const first = fakeRedis();
    await recalculateSurge(depsWith(first.client), QUIET_WEDNESDAY);
    const second = fakeRedis();
    await recalculateSurge(depsWith(second.client), QUIET_WEDNESDAY);

    expect(second.sets).toEqual(first.sets);
  });

  it('prices two runs a minute apart identically, timestamp aside', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 10, occupiedSlots: 8 },
    ]);

    const first = fakeRedis();
    await recalculateSurge(depsWith(first.client), QUIET_WEDNESDAY);
    const second = fakeRedis();
    await recalculateSurge(
      depsWith(second.client),
      new Date(QUIET_WEDNESDAY.getTime() + 60_000),
    );

    const { calculatedAt: _a, ...pricedFirst } = snapshotAt(first.sets, 'tdr1v0');
    const { calculatedAt: _b, ...pricedSecond } = snapshotAt(second.sets, 'tdr1v0');
    expect(pricedSecond).toEqual(pricedFirst);
  });

  it('writes a snapshot the API can parse back (R-VAL-01)', async () => {
    measureMock.mockResolvedValue([
      { zoneId: 'tdr1v0' as ZoneId, totalSlots: 10, occupiedSlots: 10 },
    ]);
    const redis = fakeRedis();

    await recalculateSurge(depsWith(redis.client), QUIET_WEDNESDAY);

    const written = redis.sets[0];
    expect(written).toBeDefined();
    expect(surgeSnapshotSchema.safeParse(JSON.parse(written!.value)).success).toBe(true);
  });
});

describe('surge.recalculate — the IST clock', () => {
  it('names a key surge:{zoneId}', () => {
    expect(surgeKey('tdr1v0' as ZoneId)).toBe('surge:tdr1v0');
  });

  it('reads the weekend in IST, not UTC', () => {
    // 19:00 UTC Friday is 00:30 IST Saturday. UTC would call this a weekday.
    expect(isWeekendInIST(new Date('2026-09-18T19:00:00.000Z'))).toBe(true);
    expect(isWeekendInIST(new Date('2026-09-20T17:00:00.000Z'))).toBe(true);
    // 18:30 UTC Sunday is 00:00 IST Monday.
    expect(isWeekendInIST(new Date('2026-09-20T18:30:00.000Z'))).toBe(false);
    expect(isWeekendInIST(QUIET_WEDNESDAY)).toBe(false);
  });

  it('matches a peak window on its IST day and clock time', () => {
    // 08:30 IST Wednesday, inside the 08:00-11:00 weekday window.
    expect(isWithinPeakWindow(new Date('2026-09-16T03:00:00.000Z'), GLOBAL.peakWindows)).toBe(
      true,
    );
    // 14:30 IST Wednesday, between the two windows.
    expect(isWithinPeakWindow(QUIET_WEDNESDAY, GLOBAL.peakWindows)).toBe(false);
    // 08:30 IST Saturday: the right clock time on a day the window excludes.
    expect(isWithinPeakWindow(new Date('2026-09-19T03:00:00.000Z'), GLOBAL.peakWindows)).toBe(
      false,
    );
  });

  it('treats a window as closed at its end time', () => {
    const windows: PeakWindow[] = [{ days: ['wed'], from: '08:00', to: '11:00' }];
    // 08:00 IST exactly — open.
    expect(isWithinPeakWindow(new Date('2026-09-16T02:30:00.000Z'), windows)).toBe(true);
    // 11:00 IST exactly — closed, so two adjacent windows cannot both match.
    expect(isWithinPeakWindow(new Date('2026-09-16T05:30:00.000Z'), windows)).toBe(false);
  });

  it('has no holiday calendar, and says so by never claiming one', () => {
    expect(isHolidayOrEvent(QUIET_WEDNESDAY)).toBe(false);
    expect(isHolidayOrEvent(new Date('2026-01-26T00:00:00.000Z'))).toBe(false);
  });
});

describe('surge config — merging a zone override onto the global row', () => {
  const baseRow = {
    zoneId: 'tdr1v0',
    maxMultiplierBp: null,
    peakHourModifierBp: null,
    weekendModifierBp: null,
    eventModifierBp: null,
    tiers: null,
  };

  it('falls back to the global value for every null column', () => {
    expect(mergeZoneConfig(GLOBAL, baseRow)).toEqual(GLOBAL);
  });

  it('lets a zone raise its cap above the global cap', () => {
    const airportTiers: SurgeTier[] = [
      ...DEFAULT_SURGE_TIERS,
      { minOccupancyBp: 9_500, multiplierBp: 25_000, badge: 'very_high_demand' },
    ];
    const merged = mergeZoneConfig(GLOBAL, {
      ...baseRow,
      maxMultiplierBp: 25_000,
      tiers: airportTiers,
    });

    expect(merged.maxMultiplierBp).toBe(25_000);
    expect(merged.tiers).toEqual(airportTiers);
  });

  it('lets a zone disable surge entirely with a 1.0x cap', () => {
    const merged = mergeZoneConfig(GLOBAL, { ...baseRow, maxMultiplierBp: 10_000 });
    expect(merged.maxMultiplierBp).toBe(10_000);
  });

  it('takes a partial modifier override without restating the ladder', () => {
    const merged = mergeZoneConfig(GLOBAL, { ...baseRow, peakHourModifierBp: 12_000 });
    expect(merged.peakHourModifierBp).toBe(12_000);
    expect(merged.weekendModifierBp).toBe(GLOBAL.weekendModifierBp);
    expect(merged.tiers).toEqual(GLOBAL.tiers);
  });

  it('rejects a merge that would reach a cap no tier carries', () => {
    // An operator cannot create a reachable multiplier the app has no words for.
    expect(() => mergeZoneConfig(GLOBAL, { ...baseRow, maxMultiplierBp: 25_000 })).toThrow();
  });
});
