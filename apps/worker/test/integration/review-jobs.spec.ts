import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { recomputeAgeingAggregates } from '../../src/jobs/review/recompute-aggregates.job.js';

let pg: PgTestContext;
let deps: JobDeps;

const DAY_MS = 24 * 60 * 60 * 1000;

let counter = 0;
async function seedUser(): Promise<string> {
  counter += 1;
  const [user] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9196${String(10_000_000 + counter)}`}, ${`fb-review-${String(counter)}`}, 'Seeded')
    RETURNING id`;
  return user!.id;
}

async function seedSpace(ownerId: string, lng: number): Promise<string> {
  const [space] = await pg.sql<{ id: string }[]>`
    INSERT INTO spaces (owner_id, title, address_line, city, state, pincode, location, zone_id,
                        pricing, schedule, amenities, approval_status)
    VALUES (${ownerId}, 'Space', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
            ST_SetSRID(ST_MakePoint(${lng}, 12.93), 4326)::geography,
            ST_GeoHash(ST_SetSRID(ST_MakePoint(${lng}, 12.93), 4326)::geometry, 6),
            '{"car":{"hourlyPaise":3000}}'::jsonb, '{"is24x7":true}'::jsonb, '[]'::jsonb, 'active')
    RETURNING id`;
  return space!.id;
}

async function seedBooking(driverId: string, spaceId: string): Promise<string> {
  const [booking] = await pg.sql<{ id: string }[]>`
    INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at,
                          status, completed_at, base_paise, surge_premium_paise,
                          parkease_fee_paise, gst_paise, total_paise, owner_earnings_paise)
    VALUES (${driverId}, ${spaceId}, 'car', 'hourly', now() - interval '200 days',
            now() - interval '199 days', 'completed', now() - interval '199 days',
            3000, 0, 450, 0, 3000, 2550)
    RETURNING id`;
  return booking!.id;
}

async function review(bookingId: string, spaceId: string, rating: number, ageDays: number) {
  const reviewer = await seedUser();
  await pg.sql`
    INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id,
                         rating, created_at)
    VALUES (${bookingId}, ${reviewer}, 'driver', 'space', ${spaceId}, ${rating},
            ${new Date(Date.now() - ageDays * DAY_MS).toISOString()}::timestamptz)`;
}

async function readModel(spaceId: string) {
  const [row] = await pg.sql<{ avg: number | null; count: number; updated: Date }[]>`
    SELECT rating_avg_bp AS avg, rating_count AS count, updated_at AS updated
    FROM spaces WHERE id = ${spaceId}`;
  return row!;
}

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

describe('review.recompute-aggregates', () => {
  let ownerId: string;
  let driverId: string;

  beforeEach(async () => {
    await pg.sql`TRUNCATE reviews, bookings, spaces CASCADE`;
    ownerId = await seedUser();
    driverId = await seedUser();
  });

  it('recomputes a target whose review aged out of the recency window, idempotently', async () => {
    const ageing = await seedSpace(ownerId, 77.62);
    const booking = await seedBooking(driverId, ageing);
    await review(booking, ageing, 5, 29.9);
    await review(booking, ageing, 1, 100);
    // As written at insert time: the 5★ was recent and counted twice.
    await pg.sql`UPDATE spaces SET rating_avg_bp = 36667, rating_count = 2 WHERE id = ${ageing}`;

    const steady = await seedSpace(ownerId, 77.6);
    await review(await seedBooking(driverId, steady), steady, 4, 10);
    await pg.sql`UPDATE spaces SET rating_avg_bp = 40000, rating_count = 1 WHERE id = ${steady}`;
    const steadyBefore = await readModel(steady);

    // A fifth of a day later the 5★ is 30.1 days old: one weight each, (5 + 1) / 2.
    const later = new Date(Date.now() + 0.2 * DAY_MS);
    await recomputeAgeingAggregates(deps, later);
    expect(await readModel(ageing)).toMatchObject({ avg: 30_000, count: 2 });

    await recomputeAgeingAggregates(deps, later);
    expect(await readModel(ageing)).toMatchObject({ avg: 30_000, count: 2 });

    expect((await readModel(steady)).updated).toEqual(steadyBefore.updated);
  });
});
