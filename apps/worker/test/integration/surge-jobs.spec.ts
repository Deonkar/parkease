import { surgeSnapshotSchema, type ZoneId } from '@parkease/contracts/admin';
import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { MissingSurgeConfigError, resolveSurgeConfig } from '../../src/jobs/surge/config.js';
import { measureZoneOccupancy } from '../../src/jobs/surge/occupancy.js';
import { recalculateSurge, surgeKey } from '../../src/jobs/surge/recalculate.job.js';
import { fakeRedis } from '../fake-redis.js';

let pg: PgTestContext;
let deps: JobDeps;

/** Two points ~4km apart in Bengaluru, which is several geohash-6 cells. */
const KORAMANGALA = { lat: 12.9345, lng: 77.6266 };
const INDIRANAGAR = { lat: 12.9719, lng: 77.6412 };

/** A window wide enough that no test depends on where "now" falls inside it. */
const WINDOW_MINUTES = 60;

/** 14:30 IST on Wednesday 16 Sep 2026: no peak window, not a weekend. */
const QUIET_WEDNESDAY = new Date('2026-09-16T09:00:00.000Z');

const randomPhone = (prefix: string): string =>
  `+91${prefix}${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;

async function seedUser(prefix: string): Promise<string> {
  const [user] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${randomPhone(prefix)}, ${`fb-${String(Math.random())}`}, 'Seeded')
    RETURNING id
  `;
  if (user === undefined) throw new Error('failed to seed user');
  return user.id;
}

/**
 * A listing with `slotCount` car slots. The zone id comes back from the
 * database, so every assertion below is against the value `ST_GeoHash` actually
 * produced rather than one reasoned out by hand (learnings.md).
 */
async function seedSpace(opts: {
  at: { lat: number; lng: number };
  slotCount: number;
  approvalStatus?: string;
  softDeleted?: boolean;
}): Promise<{ spaceId: string; zoneId: ZoneId }> {
  const ownerId = await seedUser('97');
  const point = `ST_SetSRID(ST_MakePoint(${String(opts.at.lng)}, ${String(opts.at.lat)}), 4326)::geography`;

  const [space] = await pg.sql<{ id: string; zone_id: string }[]>`
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status, deleted_at
    ) VALUES (
      ${ownerId}, 'Seeded Parking', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
      ${pg.sql.unsafe(point)},
      ST_GeoHash(${pg.sql.unsafe(point)}::geometry, 6),
      ${JSON.stringify({ car: { hourlyPaise: 3000 } })}::jsonb,
      ${JSON.stringify({ is24x7: true })}::jsonb,
      '[]'::jsonb,
      ${opts.approvalStatus ?? 'active'},
      ${opts.softDeleted === true ? new Date().toISOString() : null}::timestamptz
    ) RETURNING id, zone_id
  `;
  if (space === undefined) throw new Error('failed to seed space');

  for (let index = 0; index < opts.slotCount; index += 1) {
    await pg.sql`INSERT INTO space_slots (space_id, vehicle_type, slot_index)
                 VALUES (${space.id}, 'car', ${index})`;
  }

  return { spaceId: space.id, zoneId: space.zone_id as ZoneId };
}

/** Holds `slotIndexes` on `spaceId` over a window, at the given slot status. */
async function hold(opts: {
  spaceId: string;
  slotIndexes: readonly number[];
  status: 'held' | 'confirmed' | 'active' | 'released';
  startsInMinutes?: number;
  endsInMinutes?: number;
}): Promise<void> {
  const driverId = await seedUser('98');
  const startsIn = opts.startsInMinutes ?? 5;
  const endsIn = opts.endsInMinutes ?? 55;
  const bookingStatus = opts.status === 'released' ? 'cancelled' : 'confirmed';

  const [booking] = await pg.sql<{ id: string }[]>`
    INSERT INTO bookings (
      driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
      base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
      owner_earnings_paise
    ) VALUES (
      ${driverId}, ${opts.spaceId}, 'car', 'hourly',
      now() + make_interval(mins => ${startsIn}),
      now() + make_interval(mins => ${endsIn}),
      ${bookingStatus},
      6000, 0, 900, 162, 6162, 5100
    ) RETURNING id
  `;
  if (booking === undefined) throw new Error('failed to seed booking');

  for (const slotIndex of opts.slotIndexes) {
    await pg.sql`
      INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
      VALUES (
        ${booking.id}, ${opts.spaceId}, 'car', ${slotIndex},
        tstzrange(
          (now() + make_interval(mins => ${startsIn}))::timestamptz,
          (now() + make_interval(mins => ${endsIn}))::timestamptz,
          '[)'),
        ${opts.status}
      )
    `;
  }
}

const occupancyFor = async (zoneId: ZoneId) => {
  const zones = await measureZoneOccupancy(deps, WINDOW_MINUTES);
  return zones.find((zone) => zone.zoneId === zoneId);
};

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    redis: {} as JobDeps['redis'],
  };
}, 300_000);

afterAll(async () => {
  await stopPgContainer(pg);
});

beforeEach(async () => {
  await pg.sql`TRUNCATE booking_slots, bookings, space_slots, spaces, surge_zone_overrides
               RESTART IDENTITY CASCADE`;
  await pg.sql`DELETE FROM users`;
  // Restore the global row every migration 0024 seeded; one test deletes it.
  await pg.sql`
    INSERT INTO surge_config (
      key, max_multiplier_bp, peak_hour_modifier_bp, weekend_modifier_bp,
      event_modifier_bp, occupancy_window_minutes, peak_windows, tiers
    ) VALUES (
      'global', 20000, 11000, 10500, 12000, 60,
      '[{"days":["mon","tue","wed","thu","fri"],"from":"08:00","to":"11:00"}]'::jsonb,
      '[{"minOccupancyBp":0,"multiplierBp":10000,"badge":null},
        {"minOccupancyBp":6000,"multiplierBp":12500,"badge":"moderate_demand"},
        {"minOccupancyBp":7500,"multiplierBp":15000,"badge":"high_demand"},
        {"minOccupancyBp":9000,"multiplierBp":20000,"badge":"very_high_demand"}]'::jsonb
    ) ON CONFLICT (key) DO NOTHING
  `;
});

describe('occupancy measurement, against real PostGIS', () => {
  it('counts every bookable slot in a zone and none as occupied without a booking', async () => {
    const { zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 10 });

    expect(await occupancyFor(zoneId)).toEqual({
      zoneId,
      totalSlots: 10,
      occupiedSlots: 0,
    });
  });

  it('measures per slot-instance: 3 of 4 held is 3, not the whole space', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({ spaceId, slotIndexes: [0, 1, 2], status: 'confirmed' });

    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 3 });
  });

  it('counts an active slot as occupied', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({ spaceId, slotIndexes: [0], status: 'active' });

    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 1 });
  });

  it('does not let a released slot raise a zone', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({ spaceId, slotIndexes: [0, 1, 2, 3], status: 'released' });

    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 0 });
  });

  it('does not let an unpaid held slot raise a zone', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({ spaceId, slotIndexes: [0, 1, 2, 3], status: 'held' });

    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 0 });
  });

  it('ignores a booking that falls outside the forward window', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({
      spaceId,
      slotIndexes: [0, 1],
      status: 'confirmed',
      startsInMinutes: 24 * 60,
      endsInMinutes: 25 * 60,
    });

    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 0 });
  });

  it('counts a slot once even when two bookings fill the window back to back', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4 });
    await hold({ spaceId, slotIndexes: [0], status: 'confirmed', startsInMinutes: 5, endsInMinutes: 25 });
    await hold({ spaceId, slotIndexes: [0], status: 'confirmed', startsInMinutes: 25, endsInMinutes: 50 });

    // A LEFT JOIN with count(bs.id) reports 2 here, which is more slots held
    // than the slot exists.
    expect(await occupancyFor(zoneId)).toMatchObject({ totalSlots: 4, occupiedSlots: 1 });
  });

  it.each(['inactive', 'pending_approval', 'rejected'])(
    'produces no row for a zone whose only space is %s',
    async (approvalStatus) => {
      const { zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4, approvalStatus });

      expect(await occupancyFor(zoneId)).toBeUndefined();
    },
  );

  it('produces no row for a zone whose only space is soft-deleted', async () => {
    const { zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 4, softDeleted: true });

    expect(await occupancyFor(zoneId)).toBeUndefined();
  });

  it('separates two spaces ~4km apart into different geohash-6 zones', async () => {
    const near = await seedSpace({ at: KORAMANGALA, slotCount: 2 });
    const far = await seedSpace({ at: INDIRANAGAR, slotCount: 2 });

    expect(near.zoneId).not.toBe(far.zoneId);
    const zones = await measureZoneOccupancy(deps, WINDOW_MINUTES);
    expect(zones).toHaveLength(2);
  });
});

describe('surge config, loaded from the database', () => {
  it('loads and parses the seeded global row', async () => {
    const { global, byZone } = await resolveSurgeConfig(deps);

    expect(global.maxMultiplierBp).toBe(20_000);
    expect(global.occupancyWindowMinutes).toBe(60);
    expect(global.tiers).toHaveLength(4);
    expect(byZone.size).toBe(0);
  });

  it('raises MissingSurgeConfigError rather than defaulting', async () => {
    await pg.sql`DELETE FROM surge_config WHERE key = 'global'`;

    await expect(resolveSurgeConfig(deps)).rejects.toBeInstanceOf(MissingSurgeConfigError);
  });

  it('merges an enabled override and ignores a disabled one', async () => {
    await pg.sql`
      INSERT INTO surge_zone_overrides (zone_id, label, reason, enabled, peak_hour_modifier_bp)
      VALUES ('tdr1v0', 'Airport approach', 'Structural scarcity', true, 12000),
             ('tdr1v1', 'Old trial',        'No longer needed',    false, 12000)
    `;

    const { byZone } = await resolveSurgeConfig(deps);

    expect([...byZone.keys()]).toEqual(['tdr1v0']);
    expect(byZone.get('tdr1v0' as ZoneId)?.peakHourModifierBp).toBe(12_000);
  });

  it('falls back to the global config for an override that cannot merge', async () => {
    // A raised cap with no ladder that reaches it. The zone is unpriceable as
    // configured; every other zone must still be priced.
    await pg.sql`
      INSERT INTO surge_zone_overrides (zone_id, label, reason, max_multiplier_bp)
      VALUES ('tdr1v0', 'Bad override', 'Cap with no tier', 25000)
    `;

    const { byZone } = await resolveSurgeConfig(deps);

    expect(byZone.size).toBe(0);
  });
});

describe('surge.recalculate, end to end', () => {
  it('writes one key per zone under the id ST_GeoHash produced', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 10 });
    await hold({ spaceId, slotIndexes: [0, 1, 2, 3, 4, 5, 6, 7], status: 'confirmed' });
    const redis = fakeRedis();

    await recalculateSurge({ ...deps, redis: redis.client as JobDeps['redis'] }, QUIET_WEDNESDAY);

    expect(redis.counts.multi).toBe(1);
    expect(redis.sets).toHaveLength(1);
    expect(redis.sets[0]?.key).toBe(surgeKey(zoneId));
    expect(redis.sets[0]?.ttl).toBe(600);

    // 8 of 10 is above 0.75 and at or below 0.90 — the high_demand tier.
    expect(surgeSnapshotSchema.parse(JSON.parse(redis.sets[0]!.value))).toEqual({
      multiplierBp: 15_000,
      badge: 'high_demand',
      occupancyBp: 8_000,
      appliedModifiers: [],
      calculatedAt: QUIET_WEDNESDAY.toISOString(),
    });
  });

  it('writes no key at all for a zone whose only space is inactive', async () => {
    await seedSpace({ at: KORAMANGALA, slotCount: 4, approvalStatus: 'inactive' });
    const redis = fakeRedis();

    await recalculateSurge({ ...deps, redis: redis.client as JobDeps['redis'] }, QUIET_WEDNESDAY);

    expect(redis.counts.multi).toBe(0);
    expect(redis.sets).toEqual([]);
  });

  it('prices a zone with active spaces and no bookings at 1.0x', async () => {
    await seedSpace({ at: KORAMANGALA, slotCount: 6 });
    const redis = fakeRedis();

    await recalculateSurge({ ...deps, redis: redis.client as JobDeps['redis'] }, QUIET_WEDNESDAY);

    expect(surgeSnapshotSchema.parse(JSON.parse(redis.sets[0]!.value))).toMatchObject({
      multiplierBp: 10_000,
      badge: null,
    });
  });

  it('honours a zone override cap above the global cap, from the real tables', async () => {
    const { spaceId, zoneId } = await seedSpace({ at: KORAMANGALA, slotCount: 100 });
    await hold({
      spaceId,
      slotIndexes: Array.from({ length: 97 }, (_, i) => i),
      status: 'confirmed',
    });
    await pg.sql`
      INSERT INTO surge_zone_overrides (zone_id, label, reason, max_multiplier_bp, tiers)
      VALUES (
        ${zoneId}, 'Kempegowda Airport approach', 'Airport parking is 4x our rate', 25000,
        '[{"minOccupancyBp":0,"multiplierBp":10000,"badge":null},
          {"minOccupancyBp":6000,"multiplierBp":12500,"badge":"moderate_demand"},
          {"minOccupancyBp":7500,"multiplierBp":15000,"badge":"high_demand"},
          {"minOccupancyBp":9000,"multiplierBp":20000,"badge":"very_high_demand"},
          {"minOccupancyBp":9500,"multiplierBp":25000,"badge":"very_high_demand"}]'::jsonb
      )
    `;
    const redis = fakeRedis();

    await recalculateSurge({ ...deps, redis: redis.client as JobDeps['redis'] }, QUIET_WEDNESDAY);

    // Above the global 2.0x cap, because the operator said so. v1's hard-coded
    // Math.min(x, 2.0) made this unreachable.
    expect(surgeSnapshotSchema.parse(JSON.parse(redis.sets[0]!.value)).multiplierBp).toBe(25_000);
  });

  it('is idempotent: two consecutive runs write identical keys and values', async () => {
    const { spaceId } = await seedSpace({ at: KORAMANGALA, slotCount: 10 });
    await hold({ spaceId, slotIndexes: [0, 1, 2, 3, 4, 5, 6], status: 'confirmed' });
    await seedSpace({ at: INDIRANAGAR, slotCount: 5 });

    const first = fakeRedis();
    await recalculateSurge({ ...deps, redis: first.client as JobDeps['redis'] }, QUIET_WEDNESDAY);
    const second = fakeRedis();
    await recalculateSurge({ ...deps, redis: second.client as JobDeps['redis'] }, QUIET_WEDNESDAY);

    expect(second.sets).toHaveLength(2);
    expect(second.sets).toEqual(first.sets);
  });
});
