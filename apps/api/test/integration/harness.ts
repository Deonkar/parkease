import {
  BASIS_POINTS,
  DEFAULT_SURGE_TIERS,
  NO_SURGE_BP,
  type SurgeSnapshot,
} from '@parkease/contracts/admin';
import type { Amenity } from '@parkease/contracts/enums';
import { spacePricingSchema, type SpaceSchedule } from '@parkease/contracts/owner';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

import {
  startPgContainer,
  stopPgContainer,
  runMigrations,
  type PgTestContext,
  // Relative, not by package name: @parkease/testing depending on the api would
  // be a Turborepo cycle (see learnings.md).
} from '../../../../packages/testing/src/pg-container.js';
import { SearchCache } from '../../src/domains/space/search-cache.js';
import { SearchService } from '../../src/domains/space/search.service.js';
import { SurgeService } from '../../src/domains/surge/surge.service.js';
import type { Database } from '../../src/platform/db/db.module.js';
import type { RedisClient } from '../../src/platform/redis/redis.module.js';

/**
 * An in-memory stand-in with Redis' actual MGET semantics (null per missing
 * key). The surge and cache *logic* is unit-tested against fakes already; what
 * these tests need from Redis is a place to write `surge:{zone}` by hand and a
 * switch to make it unreachable.
 */
export class FakeRedis {
  private readonly store = new Map<string, string>();
  private failing = false;

  fail(): void {
    this.failing = true;
  }

  clear(): void {
    this.store.clear();
    this.failing = false;
  }

  get(key: string): Promise<string | null> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<string> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  mget(keys: string[]): Promise<(string | null)[]> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(keys.map((k) => this.store.get(k) ?? null));
  }

  asClient(): RedisClient {
    return this as unknown as RedisClient;
  }
}

export interface Harness {
  readonly pg: PgTestContext;
  readonly sql: postgres.Sql;
  readonly db: Database;
  readonly redis: FakeRedis;
  readonly search: SearchService;
  /** Counts SQL statements the service issues, for the R-PERF-02 guard. */
  readonly statements: { count: number; reset: () => void };
  ownerId: string;
  driverId: string;
}

export async function startHarness(): Promise<Harness> {
  const pg = await startPgContainer();
  // The connection string, not the pool: migrations need their own max: 1
  // connection because multi-statement files run in an implicit transaction.
  await runMigrations(pg.connectionString);

  const statements = { count: 0, reset: (): void => void (statements.count = 0) };

  const client = pg.sql;
  const db = drizzle(client) as unknown as Database;

  // Wrap execute so the N+1 guard can count statements without a proxy driver.
  const realExecute = db.execute.bind(db);
  Object.defineProperty(db, 'execute', {
    value: (query: Parameters<typeof realExecute>[0]) => {
      statements.count += 1;
      return realExecute(query);
    },
  });

  const redis = new FakeRedis();
  const search = new SearchService(
    db,
    new SearchCache(redis.asClient()),
    new SurgeService(redis.asClient()),
  );

  const harness: Harness = {
    pg,
    sql: pg.sql,
    db,
    redis,
    search,
    statements,
    ownerId: '',
    driverId: '',
  };

  harness.ownerId = await seedUser(harness, 'owner');
  harness.driverId = await seedUser(harness, 'driver');

  return harness;
}

export async function stopHarness(h: Harness): Promise<void> {
  await stopPgContainer(h.pg);
}

/** Everything except users, so each test starts from a known empty world. */
export async function truncateSpaces(h: Harness): Promise<void> {
  await h.sql`TRUNCATE booking_slots, bookings, space_photos, space_slots, spaces CASCADE`;
  h.redis.clear();
  h.statements.reset();
}

let userCounter = 0;

export async function seedUser(h: Harness, role: string): Promise<string> {
  userCounter += 1;
  const phone = `+9198${String(10_000_000 + userCounter)}`;
  const rows = await h.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${phone}, ${`fb-${role}-${String(userCounter)}`}, ${`${role} ${String(userCounter)}`})
    RETURNING id
  `;
  const user = rows[0];
  if (user === undefined) throw new Error('failed to seed user');

  await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${user.id}, ${role})`;
  return user.id;
}

/**
 * Fixtures write plain numbers; `spacePricingSchema` applies the Paise brand on
 * the way in, so a test never has to spell out a branded literal.
 */
interface TestDurationPricing {
  readonly hourlyPaise: number;
  readonly dailyPaise?: number;
  readonly weeklyPaise?: number;
  readonly monthlyPaise?: number;
}

export interface TestPricing {
  readonly car?: TestDurationPricing;
  readonly twoWheeler?: TestDurationPricing;
}

export const HOURLY_ONLY: TestPricing = { car: { hourlyPaise: 3000 } };
export const OPEN_ALWAYS: SpaceSchedule = { is24x7: true };

export interface SeedSpaceOptions {
  readonly lat: number;
  readonly lng: number;
  readonly title?: string;
  readonly approvalStatus?: string;
  readonly deleted?: boolean;
  readonly pricing?: TestPricing;
  readonly amenities?: readonly Amenity[];
  readonly ratingAvgBp?: number | null;
  readonly ratingCount?: number;
  readonly schedule?: SpaceSchedule;
  readonly carSlots?: number;
  readonly twoWheelerSlots?: number;
  readonly thumbnail?: string;
}

/**
 * `zone_id` is derived by PostGIS exactly as migration 0013 derives it, so the
 * fixtures exercise the same value discovery reads.
 */
export async function seedSpace(h: Harness, opts: SeedSpaceOptions): Promise<string> {
  const rows = await h.sql<{ id: string }[]>`
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode,
      location, zone_id, pricing, schedule, amenities,
      approval_status, rating_avg_bp, rating_count, deleted_at
    )
    VALUES (
      ${h.ownerId},
      ${opts.title ?? 'Test Space'},
      '5th Cross, Koramangala',
      'Bengaluru',
      'Karnataka',
      '560034',
      ST_SetSRID(ST_MakePoint(${opts.lng}, ${opts.lat}), 4326)::geography,
      ST_GeoHash(ST_SetSRID(ST_MakePoint(${opts.lng}, ${opts.lat}), 4326)::geometry, 6),
      ${JSON.stringify(spacePricingSchema.parse(opts.pricing ?? HOURLY_ONLY))}::jsonb,
      ${JSON.stringify(opts.schedule ?? OPEN_ALWAYS)}::jsonb,
      ${JSON.stringify([...(opts.amenities ?? [])])}::jsonb,
      ${opts.approvalStatus ?? 'active'},
      ${opts.ratingAvgBp ?? null},
      ${opts.ratingCount ?? 0},
      ${opts.deleted === true ? new Date().toISOString() : null}::timestamptz
    )
    RETURNING id
  `;

  const space = rows[0];
  if (space === undefined) throw new Error('failed to seed space');

  const carSlots = opts.carSlots ?? 1;
  const twoWheelerSlots = opts.twoWheelerSlots ?? 0;

  for (let i = 0; i < carSlots; i += 1) {
    await h.sql`
      INSERT INTO space_slots (space_id, vehicle_type, slot_index)
      VALUES (${space.id}, 'car', ${i})
    `;
  }
  for (let i = 0; i < twoWheelerSlots; i += 1) {
    await h.sql`
      INSERT INTO space_slots (space_id, vehicle_type, slot_index)
      VALUES (${space.id}, 'two_wheeler', ${i})
    `;
  }

  if (opts.thumbnail !== undefined) {
    await h.sql`
      INSERT INTO space_photos (
        space_id, cloudinary_public_id, url, format, bytes, width, height,
        display_order, is_primary
      )
      VALUES (${space.id}, 'pid', ${opts.thumbnail}, 'jpg', 1000, 800, 600, 0, true)
    `;
  }

  return space.id;
}

export interface SeedBookingOptions {
  readonly spaceId: string;
  readonly vehicleType: 'car' | 'two_wheeler';
  readonly slotIndex: number;
  readonly slotStatus: 'held' | 'confirmed' | 'active' | 'released';
  /** Offsets from now, in minutes. Defaults cover the discovery window. */
  readonly startsInMinutes?: number;
  readonly endsInMinutes?: number;
}

export async function seedBooking(h: Harness, opts: SeedBookingOptions): Promise<string> {
  const startsIn = opts.startsInMinutes ?? -5;
  const endsIn = opts.endsInMinutes ?? 55;

  const rows = await h.sql<{ id: string }[]>`
    INSERT INTO bookings (
      driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
      base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
      owner_earnings_paise
    )
    VALUES (
      ${h.driverId}, ${opts.spaceId}, ${opts.vehicleType}, 'hourly',
      now() + make_interval(mins => ${startsIn}),
      now() + make_interval(mins => ${endsIn}),
      'confirmed',
      3000, 0, 450, 0, 3000, 2550
    )
    RETURNING id
  `;

  const booking = rows[0];
  if (booking === undefined) throw new Error('failed to seed booking');

  await h.sql`
    INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
    VALUES (
      ${booking.id}, ${opts.spaceId}, ${opts.vehicleType}, ${opts.slotIndex},
      tstzrange(
        now() + make_interval(mins => ${startsIn}),
        now() + make_interval(mins => ${endsIn}),
        '[)'
      ),
      ${opts.slotStatus}
    )
  `;

  return booking.id;
}

/**
 * A `surge:{zone}` value exactly as the worker writes it: a `SurgeSnapshot` in
 * integer basis points, carrying the tier's own badge.
 *
 * Tests still say `surgePayload(1.5)`, because "1.5x" is how the fixture reads
 * — the conversion happens here, in one place. The badge is not decorative:
 * `surgeSnapshotSchema` refuses a surging snapshot that names no tier, so a
 * payload without one would be read back as no surge at all.
 */
export function surgePayload(multiplier: number): string {
  const multiplierBp = Math.round(multiplier * BASIS_POINTS);
  const tier = [...DEFAULT_SURGE_TIERS]
    .reverse()
    .find((t) => t.multiplierBp <= multiplierBp && t.badge !== null);

  const snapshot: SurgeSnapshot = {
    multiplierBp,
    badge: multiplierBp === NO_SURGE_BP ? null : (tier?.badge ?? 'very_high_demand'),
    occupancyBp: 8_000,
    appliedModifiers: [],
    calculatedAt: new Date().toISOString(),
  };

  return JSON.stringify(snapshot);
}
