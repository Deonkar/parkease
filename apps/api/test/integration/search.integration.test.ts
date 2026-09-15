import { searchSpacesQuerySchema } from '@parkease/contracts/driver';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchPage } from '../../src/domains/space/search.service.js';
import { SURGE_KEY_PREFIX } from '../../src/domains/surge/surge.service.js';
import { zoneIdFor } from '../../src/platform/geo/geohash.js';
import { logger } from '../../src/platform/observability/logger.js';
import { toSpaceResultView } from '../../src/roles/driver/views/space-result.view.js';

import {
  seedBooking,
  seedSpace,
  startHarness,
  stopHarness,
  surgePayload,
  truncateSpaces,
  type Harness,
  type SeedSpaceOptions,
} from './harness.js';

const ORIGIN = { lat: 12.9345, lng: 77.6266 };

const METRES_PER_DEGREE_LAT = 111_320;

/** A point `metres` due north of the origin. */
function northOf(metres: number): { lat: number; lng: number } {
  return { lat: ORIGIN.lat + metres / METRES_PER_DEGREE_LAT, lng: ORIGIN.lng };
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 300_000);

afterAll(async () => {
  if (h !== undefined) await stopHarness(h);
});

beforeEach(async () => {
  await truncateSpaces(h);
});

async function search(overrides: Record<string, unknown> = {}): Promise<SearchPage> {
  const q = searchSpacesQuerySchema.parse({ lat: ORIGIN.lat, lng: ORIGIN.lng, ...overrides });
  return h.search.findNearby(q);
}

function idsOf(page: SearchPage): string[] {
  return page.items.map((item) => item.candidate.id);
}

/** Seeds at 100m north unless told otherwise, so everything is well inside the radius. */
async function space(opts: Partial<SeedSpaceOptions> = {}): Promise<string> {
  return seedSpace(h, { ...northOf(100), ...opts });
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe('visibility', () => {
  it('returns an active space inside the radius', async () => {
    const id = await space({ title: 'Visible' });
    expect(idsOf(await search())).toEqual([id]);
  });

  for (const status of ['pending_approval', 'changes_requested', 'rejected', 'inactive']) {
    it(`hides a ${status} space`, async () => {
      await space({ approvalStatus: status });
      expect(idsOf(await search())).toEqual([]);
    });
  }

  it('hides an active space that has been soft-deleted', async () => {
    await space({ deleted: true });
    expect(idsOf(await search())).toEqual([]);
  });

  it('hides a space 50m outside the radius and keeps one 50m inside', async () => {
    const inside = await seedSpace(h, { ...northOf(4950), title: 'Inside' });
    await seedSpace(h, { ...northOf(5050), title: 'Outside' });

    expect(idsOf(await search({ radiusM: 5000 }))).toEqual([inside]);
  });

  it('honours a narrowed radius at the boundary in both directions', async () => {
    const near = await seedSpace(h, { ...northOf(950), title: 'Near' });
    const far = await seedSpace(h, { ...northOf(1050), title: 'Far' });

    expect(idsOf(await search({ radiusM: 1000 }))).toEqual([near]);
    h.redis.clear();
    expect(idsOf(await search({ radiusM: 2000 }))).toEqual([near, far]);
  });
});

// ---------------------------------------------------------------------------
// Every filter, one test each
// ---------------------------------------------------------------------------

describe('filters', () => {
  it('vehicleType=two_wheeler excludes a space with only car slots', async () => {
    const bike = await space({
      title: 'Bike',
      pricing: { twoWheeler: { hourlyPaise: 1500 } },
      carSlots: 0,
      twoWheelerSlots: 2,
    });
    await space({ title: 'Car only', carSlots: 2, twoWheelerSlots: 0 });

    expect(idsOf(await search({ vehicleType: 'two_wheeler' }))).toEqual([bike]);
  });

  it('durationType=monthly excludes a space priced hourly-only', async () => {
    const monthly = await space({
      title: 'Monthly',
      pricing: { car: { hourlyPaise: 3000, monthlyPaise: 500_000 } },
    });
    await space({ title: 'Hourly only', pricing: { car: { hourlyPaise: 3000 } } });

    expect(idsOf(await search({ durationType: 'monthly' }))).toEqual([monthly]);
  });

  it('minPricePaise=2000 excludes a 1500 paise space', async () => {
    const dear = await space({ title: 'Dear', pricing: { car: { hourlyPaise: 3000 } } });
    await space({ title: 'Cheap', pricing: { car: { hourlyPaise: 1500 } } });

    expect(idsOf(await search({ minPricePaise: 2000 }))).toEqual([dear]);
  });

  it('maxPricePaise=2000 excludes a 3000 paise space', async () => {
    const cheap = await space({ title: 'Cheap', pricing: { car: { hourlyPaise: 1500 } } });
    await space({ title: 'Dear', pricing: { car: { hourlyPaise: 3000 } } });

    expect(idsOf(await search({ maxPricePaise: 2000 }))).toEqual([cheap]);
  });

  it('amenities=covered,cctv excludes a space with only covered — containment, not overlap', async () => {
    const both = await space({ title: 'Both', amenities: ['covered', 'cctv'] });
    await space({ title: 'Covered only', amenities: ['covered'] });

    expect(idsOf(await search({ amenities: 'covered,cctv' }))).toEqual([both]);
  });

  it('amenities matches a space carrying extra amenities beyond those asked for', async () => {
    const id = await space({ amenities: ['covered', 'cctv', 'lit'] });
    expect(idsOf(await search({ amenities: 'covered,cctv' }))).toEqual([id]);
  });

  it('minRating=4 excludes a 3.9-rated space and an unrated one', async () => {
    const good = await space({ title: 'Good', ratingAvgBp: 42_000, ratingCount: 18 });
    await space({ title: 'Mediocre', ratingAvgBp: 39_000, ratingCount: 6 });
    await space({ title: 'New', ratingAvgBp: null, ratingCount: 0 });

    expect(idsOf(await search({ minRating: 4 }))).toEqual([good]);
  });

  it('minRating=3.9 includes a space sitting on exactly 39000 basis points', async () => {
    // 3.9 * 10000 is 39000.000000000004 in floating point. Rounding to integer
    // basis points is what keeps this space in the results.
    const id = await space({ ratingAvgBp: 39_000, ratingCount: 6 });
    expect(idsOf(await search({ minRating: 3.9 }))).toEqual([id]);
  });

  it('with no vehicleType, price falls back to the cheaper of car and two-wheeler', async () => {
    const id = await space({
      pricing: { car: { hourlyPaise: 3000 }, twoWheeler: { hourlyPaise: 1500 } },
      twoWheelerSlots: 1,
    });

    const page = await search();
    expect(page.items[0]?.candidate.basePricePaise).toBe(1500);
    expect(page.items[0]?.candidate.id).toBe(id);
  });

  it('with no vehicleType, a space priced for only one vehicle still gets that price', async () => {
    await space({
      pricing: { twoWheeler: { hourlyPaise: 1200 } },
      carSlots: 0,
      twoWheelerSlots: 1,
    });

    const page = await search();
    expect(page.items[0]?.candidate.basePricePaise).toBe(1200);
  });

  it('applies every filter as an intersection, not a union', async () => {
    const match = await seedSpace(h, {
      ...northOf(500),
      title: 'The only match',
      pricing: { twoWheeler: { hourlyPaise: 2000 } },
      amenities: ['covered', 'cctv'],
      ratingAvgBp: 44_000,
      ratingCount: 10,
      carSlots: 0,
      twoWheelerSlots: 2,
    });

    // Each of these fails exactly one predicate.
    await seedSpace(h, {
      ...northOf(9000), // outside radius
      pricing: { twoWheeler: { hourlyPaise: 2000 } },
      amenities: ['covered', 'cctv'],
      ratingAvgBp: 44_000,
      carSlots: 0,
      twoWheelerSlots: 2,
    });
    await seedSpace(h, {
      ...northOf(500), // car only
      pricing: { car: { hourlyPaise: 2000 } },
      amenities: ['covered', 'cctv'],
      ratingAvgBp: 44_000,
      carSlots: 2,
      twoWheelerSlots: 0,
    });
    await seedSpace(h, {
      ...northOf(500), // too expensive
      pricing: { twoWheeler: { hourlyPaise: 9000 } },
      amenities: ['covered', 'cctv'],
      ratingAvgBp: 44_000,
      carSlots: 0,
      twoWheelerSlots: 2,
    });
    await seedSpace(h, {
      ...northOf(500), // missing cctv
      pricing: { twoWheeler: { hourlyPaise: 2000 } },
      amenities: ['covered'],
      ratingAvgBp: 44_000,
      carSlots: 0,
      twoWheelerSlots: 2,
    });
    await seedSpace(h, {
      ...northOf(500), // rated too low
      pricing: { twoWheeler: { hourlyPaise: 2000 } },
      amenities: ['covered', 'cctv'],
      ratingAvgBp: 30_000,
      carSlots: 0,
      twoWheelerSlots: 2,
    });

    const page = await search({
      radiusM: 2000,
      vehicleType: 'two_wheeler',
      minPricePaise: 1000,
      maxPricePaise: 2500,
      amenities: 'covered,cctv',
      minRating: 4,
      sortBy: 'price',
    });

    expect(idsOf(page)).toEqual([match]);
  });
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

describe('availability', () => {
  it('reports a car slot consumed by a confirmed booking as unavailable', async () => {
    const id = await space({ carSlots: 1, twoWheelerSlots: 3 });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });

    const page = await search();
    expect(page.items[0]?.availableSlots).toEqual({ car: 0, twoWheeler: 3 });
  });

  it('drops that space entirely when vehicleType=car is requested', async () => {
    const id = await space({ carSlots: 1, twoWheelerSlots: 3 });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });

    expect(idsOf(await search({ vehicleType: 'car' }))).toEqual([]);
  });

  it('leaves two-wheeler slots unaffected — availability is per (vehicle_type, slot_index)', async () => {
    const id = await space({
      carSlots: 2,
      twoWheelerSlots: 3,
      pricing: { car: { hourlyPaise: 3000 }, twoWheeler: { hourlyPaise: 1500 } },
    });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });

    const page = await search();
    expect(page.items[0]?.availableSlots).toEqual({ car: 1, twoWheeler: 3 });
    expect(idsOf(await search({ vehicleType: 'two_wheeler' }))).toContain(id);
  });

  it('does not let a released booking_slots row consume a slot', async () => {
    // The status set is ('held','confirmed','active','released') — there is no
    // 'cancelled'. Only confirmed and active consume, matching the
    // booking_slots_no_overlap exclusion constraint's own WHERE clause.
    const id = await space({ carSlots: 1 });
    await seedBooking(h, { spaceId: id, vehicleType: 'car', slotIndex: 0, slotStatus: 'released' });

    expect((await search()).items[0]?.availableSlots.car).toBe(1);
  });

  it('does not let a merely held booking_slots row consume a slot', async () => {
    const id = await space({ carSlots: 1 });
    await seedBooking(h, { spaceId: id, vehicleType: 'car', slotIndex: 0, slotStatus: 'held' });

    expect((await search()).items[0]?.availableSlots.car).toBe(1);
  });

  it('counts an active booking as consuming', async () => {
    const id = await space({ carSlots: 1 });
    await seedBooking(h, { spaceId: id, vehicleType: 'car', slotIndex: 0, slotStatus: 'active' });

    expect((await search()).items[0]?.availableSlots.car).toBe(0);
  });

  it('does not let a booking that ended before now consume a slot', async () => {
    const id = await space({ carSlots: 1 });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
      startsInMinutes: -180,
      endsInMinutes: -120,
    });

    expect((await search()).items[0]?.availableSlots.car).toBe(1);
  });

  it('does not let a booking starting after the discovery window consume a slot', async () => {
    const id = await space({ carSlots: 1 });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
      startsInMinutes: 120,
      endsInMinutes: 180,
    });

    expect((await search()).items[0]?.availableSlots.car).toBe(1);
  });

  it('is never served from cache, even while the candidate cache is warm', async () => {
    // R-PERF-05. The second request must see the booking made in between, even
    // though the 60s candidate entry written by the first is still valid.
    const id = await space({ carSlots: 1, twoWheelerSlots: 1 });

    const before = await search();
    expect(before.items[0]?.availableSlots.car).toBe(1);

    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });

    h.statements.reset();
    const after = await search();

    expect(after.items[0]?.availableSlots.car).toBe(0);
    // Exactly one statement proves the candidate set really did come from cache
    // while the availability count did not.
    expect(h.statements.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Statement counts — the N+1 guard (R-PERF-02)
// ---------------------------------------------------------------------------

describe('statement counts', () => {
  it('issues exactly 2 statements on a cache miss and 1 on a hit', async () => {
    for (let i = 0; i < 5; i += 1) await seedSpace(h, northOf(100 + i * 10));

    h.statements.reset();
    await search();
    expect(h.statements.count).toBe(2);

    h.statements.reset();
    await search();
    expect(h.statements.count).toBe(1);
  });

  it('does not issue a statement per space', async () => {
    for (let i = 0; i < 20; i += 1) await seedSpace(h, northOf(100 + i * 10));

    h.statements.reset();
    const page = await search({ limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(h.statements.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sorting and pagination
// ---------------------------------------------------------------------------

describe('sorting', () => {
  it('sortBy=distance is non-decreasing and agrees with an independent calculation', async () => {
    const distances = [1500, 300, 2400, 900];
    for (const d of distances) await seedSpace(h, northOf(d));

    const page = await search({ sortBy: 'distance' });
    const reported = page.items.map((i) => i.candidate.distanceM);

    expect([...reported]).toEqual([...reported].sort((a, b) => a - b));

    for (const item of page.items) {
      const expected = haversineM(ORIGIN, {
        lat: item.candidate.lat,
        lng: item.candidate.lng,
      });
      // ST_Distance on geography measures on the WGS84 spheroid; haversine
      // measures on a sphere of mean radius 6371km. These fixtures are laid out
      // due north, and the meridional radius of curvature near 13°N is about
      // 6336km — 0.55% smaller than the mean — so the two genuinely disagree by
      // roughly half a percent. A 1m tolerance is not achievable against a
      // spheroid; 1% is the honest bound, and still catches a wrong origin, a
      // swapped lat/lng, or a unit error.
      expect(Math.abs(item.candidate.distanceM - expected) / expected).toBeLessThan(0.01);
    }
  });

  it('sortBy=price is non-decreasing', async () => {
    for (const p of [3000, 1500, 9000, 2500]) {
      await seedSpace(h, { ...northOf(200), pricing: { car: { hourlyPaise: p } } });
    }

    const prices = (await search({ sortBy: 'price' })).items.map((i) => i.candidate.basePricePaise);

    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
    expect(prices).toEqual([1500, 2500, 3000, 9000]);
  });

  it('sortBy=rating is non-increasing and puts unrated spaces last', async () => {
    await seedSpace(h, { ...northOf(200), title: 'A', ratingAvgBp: 39_000, ratingCount: 4 });
    await seedSpace(h, { ...northOf(200), title: 'B', ratingAvgBp: null, ratingCount: 0 });
    await seedSpace(h, { ...northOf(200), title: 'C', ratingAvgBp: 48_000, ratingCount: 9 });

    const page = await search({ sortBy: 'rating' });
    const ratings = page.items.map((i) => i.candidate.ratingAvgBp ?? 0);

    expect(ratings).toEqual([48_000, 39_000, 0]);
    expect(page.items.at(-1)?.candidate.ratingAvgBp).toBeNull();
  });
});

describe('cursor pagination', () => {
  async function pageThrough(sortBy: string): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let guard = 0; guard < 10; guard += 1) {
      const page: SearchPage = await search({
        sortBy,
        limit: 20,
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...idsOf(page));
      if (!page.hasMore) return seen;
      cursor = page.nextCursor;
      expect(cursor).not.toBeNull();
    }

    throw new Error('pagination did not terminate');
  }

  it('pages through 55 spaces at limit=20 with no duplicates and no omissions', async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 55; i += 1) seeded.push(await seedSpace(h, northOf(100 + i * 10)));

    const seen = await pageThrough('distance');

    expect(seen).toHaveLength(55);
    expect(new Set(seen).size).toBe(55);
    expect([...seen].sort()).toEqual([...seeded].sort());
  });

  it('pages stably under a price sort where many spaces share a price', async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 55; i += 1) {
      seeded.push(
        await seedSpace(h, { ...northOf(100 + i), pricing: { car: { hourlyPaise: 3000 } } }),
      );
    }

    const seen = await pageThrough('price');

    expect(new Set(seen).size).toBe(55);
    expect([...seen].sort()).toEqual([...seeded].sort());
  });

  it('cannot resurface an already-returned id when a space is inserted mid-pagination', async () => {
    for (let i = 0; i < 30; i += 1) await seedSpace(h, northOf(1000 + i * 10));

    const first = await search({ limit: 20 });
    const firstIds = idsOf(first);
    expect(first.hasMore).toBe(true);

    // A new space closer than everything already returned.
    await seedSpace(h, { ...northOf(50), title: 'Latecomer' });

    const second = await search({
      limit: 20,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });

    for (const id of idsOf(second)) expect(firstIds).not.toContain(id);
  });

  it('rejects a cursor replayed against a different filter set', async () => {
    for (let i = 0; i < 25; i += 1) await seedSpace(h, northOf(100 + i * 10));

    const first = await search({ limit: 20 });
    expect(first.nextCursor).not.toBeNull();

    await expect(
      search({ limit: 20, minRating: 4, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a garbage cursor with 400 INVALID_CURSOR', async () => {
    await space();

    await expect(search({ cursor: 'not-a-real-cursor' })).rejects.toMatchObject({
      status: 400,
      response: { error: 'invalid cursor' },
    });
  });

  it('bypasses the cache for page 2 so keyset correctness wins over hit rate', async () => {
    for (let i = 0; i < 25; i += 1) await seedSpace(h, northOf(100 + i * 10));

    const first = await search({ limit: 20 });

    h.statements.reset();
    await search({ limit: 20, ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }) });

    expect(h.statements.count).toBe(2);
  });

  it('reports hasMore without a second COUNT', async () => {
    for (let i = 0; i < 3; i += 1) await seedSpace(h, northOf(100 + i * 10));

    const page = await search({ limit: 20 });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe('query schema bounds', () => {
  it('rejects limit=200', () => {
    expect(() => searchSpacesQuerySchema.parse({ ...ORIGIN, limit: 200 })).toThrow();
  });

  it('defaults limit to 20 when absent', () => {
    expect(searchSpacesQuerySchema.parse({ ...ORIGIN }).limit).toBe(20);
  });

  it('rejects a radius above the maximum', () => {
    expect(() => searchSpacesQuerySchema.parse({ ...ORIGIN, radiusM: 25_001 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Surge
// ---------------------------------------------------------------------------

describe('surge', () => {
  it('is 1.0 on every item with an empty Redis', async () => {
    await space();
    await space({ title: 'Second' });

    const page = await search();
    expect(page.items.map((i) => i.surgeMultiplier)).toEqual([1, 1]);
  });

  it('picks up a hand-written surge key with no code change', async () => {
    // This is what proves task 10 retrofits nothing.
    const point = northOf(100);
    await space(point);

    const zone = zoneIdFor(point);
    await h.redis.set(`${SURGE_KEY_PREFIX}${zone}`, surgePayload(1.5));

    const item = (await search()).items[0];
    expect(item?.surgeMultiplier).toBe(1.5);

    const view = toSpaceResultView(item!);
    expect(view.basePricePaise).toBe(3000);
    expect(view.effectivePricePaise).toBe(4500);
  });

  it('returns to 1.0 when the key is deleted', async () => {
    const point = northOf(100);
    await space(point);

    await h.redis.set(`${SURGE_KEY_PREFIX}${zoneIdFor(point)}`, surgePayload(1.5));
    expect((await search()).items[0]?.surgeMultiplier).toBe(1.5);

    h.redis.clear();
    expect((await search()).items[0]?.surgeMultiplier).toBe(1);
  });

  it('carries no GST in the effective price', async () => {
    const point = northOf(100);
    await space(point);
    await h.redis.set(`${SURGE_KEY_PREFIX}${zoneIdFor(point)}`, surgePayload(2));

    const view = toSpaceResultView((await search()).items[0]!);

    // Base plus surge only. 18% GST on the ParkEase fee would show up here.
    expect(view.effectivePricePaise).toBe(6000);
  });

  it('uses the zone the space is actually in', async () => {
    const near = northOf(100);
    const far = { lat: 13.05, lng: 77.72 };
    await seedSpace(h, { ...near, title: 'Near' });
    await seedSpace(h, { ...far, title: 'Far' });

    await h.redis.set(`${SURGE_KEY_PREFIX}${zoneIdFor(far)}`, surgePayload(2));

    const page = await search({ radiusM: 25_000, sortBy: 'distance' });
    const byTitle = new Map(page.items.map((i) => [i.candidate.title, i.surgeMultiplier]));

    expect(byTitle.get('Near')).toBe(1);
    expect(byTitle.get('Far')).toBe(2);
  });
});

describe('Redis unreachable', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still returns results, with every multiplier 1.0 and a warning logged', async () => {
    // ADR-010: Redis is a cache. It being down degrades pricing, never the search.
    await space();
    h.redis.fail();

    const page = await search();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.surgeMultiplier).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('still computes availability with Redis down', async () => {
    const id = await space({ carSlots: 2 });
    await seedBooking(h, {
      spaceId: id,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'confirmed',
    });
    h.redis.fail();

    expect((await search()).items[0]?.availableSlots.car).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The view, end to end
// ---------------------------------------------------------------------------

describe('the response item', () => {
  it('carries a thumbnail, rating and open state through to the view', async () => {
    await space({
      title: 'Basement Parking',
      ratingAvgBp: 42_000,
      ratingCount: 18,
      amenities: ['covered', 'cctv'],
      thumbnail: 'https://res.cloudinary.com/parkease/image/upload/v1/a.jpg',
      twoWheelerSlots: 3,
    });

    const view = toSpaceResultView((await search()).items[0]!);

    expect(view.title).toBe('Basement Parking');
    expect(view.rating).toBe(4.2);
    expect(view.reviewCount).toBe(18);
    expect(view.amenities).toEqual(['covered', 'cctv']);
    expect(view.thumbnail).toContain('cloudinary');
    expect(view.availableSlots).toEqual({ car: 1, twoWheeler: 3 });
    expect(view.isOpenNow).toBe(true);
  });

  it('reports an unreviewed space as rating null, never zero', async () => {
    await space({ ratingAvgBp: null, ratingCount: 0 });

    const view = toSpaceResultView((await search()).items[0]!);
    expect(view.rating).toBeNull();
  });

  it('shows a closed space rather than hiding it', async () => {
    // Discovery has no requested time window, so a closed space is labelled,
    // not filtered out.
    await space({
      schedule: {
        is24x7: false,
        days: {
          mon: { isOpen: false },
          tue: { isOpen: false },
          wed: { isOpen: false },
          thu: { isOpen: false },
          fri: { isOpen: false },
          sat: { isOpen: false },
          sun: { isOpen: false },
        },
      },
    });

    const page = await search();
    expect(page.items).toHaveLength(1);
    expect(toSpaceResultView(page.items[0]!).isOpenNow).toBe(false);
  });
});
