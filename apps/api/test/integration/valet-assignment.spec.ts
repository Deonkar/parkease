import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import { OFFER_FANOUT, ONLINE_HEARTBEAT_WINDOW_SECONDS } from '@parkease/contracts/valet';
import { originFromJobPickup, originFromPoint, valetCandidateQuery } from '@parkease/db/queries';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssignmentService } from '../../src/domains/valet/assignment.service.js';
import { logger } from '../../src/platform/observability/logger.js';

import {
  type Harness,
  HOURLY_ONLY,
  OPEN_ALWAYS,
  seedBooking,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
} from './harness.js';

/**
 * The candidate search, against real PostGIS.
 *
 * Distances are seeded as offsets in degrees from a fixed origin and then
 * asserted in metres as PostGIS computes them — no haversine in the test either,
 * or it would be checking its own arithmetic rather than the query's.
 */

const ORIGIN = { lat: 12.9352, lng: 77.6245 };

/** Degrees of longitude per metre at this latitude, near enough for fixtures. */
const DEG_PER_M = 1 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));

let h: Harness;
let assignment: AssignmentService;
let spaceId: string;

interface SeedValetOptions {
  readonly metresAway: number;
  readonly ratingAvgBp?: number | null;
  readonly ratingCount?: number;
  readonly verification?: string;
  readonly isOnline?: boolean;
  readonly lastSeenSecondsAgo?: number;
  readonly licenceExpiresInDays?: number | null;
  readonly roleStatus?: string;
  readonly userStatus?: string;
  readonly onLiveJob?: boolean;
}

async function seedValet(opts: SeedValetOptions): Promise<string> {
  const userId = await seedUser(h, 'valet');
  const lng = ORIGIN.lng + opts.metresAway * DEG_PER_M;
  const ratingCount = opts.ratingCount ?? (opts.ratingAvgBp == null ? 0 : 5);

  await h.sql`
    INSERT INTO valet_profiles (
      user_id, verification_status, is_online, last_seen_at, current_location,
      licence_expires_at, rating_avg_bp, rating_count
    )
    VALUES (
      ${userId},
      ${opts.verification ?? 'verified'},
      ${opts.isOnline ?? true},
      now() - make_interval(secs => ${opts.lastSeenSecondsAgo ?? 5}),
      ST_SetSRID(ST_MakePoint(${lng}, ${ORIGIN.lat}), 4326)::geography,
      ${
        opts.licenceExpiresInDays === null
          ? null
          : h.sql`now() + make_interval(days => ${opts.licenceExpiresInDays ?? 365})`
      },
      ${opts.ratingAvgBp ?? null},
      ${ratingCount}
    )
  `;

  if (opts.roleStatus !== undefined) {
    await h.sql`UPDATE user_roles SET status = ${opts.roleStatus} WHERE user_id = ${userId}`;
  }
  if (opts.userStatus !== undefined) {
    await h.sql`UPDATE users SET status = ${opts.userStatus} WHERE id = ${userId}`;
  }
  if (opts.onLiveJob === true) {
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 3,
      slotStatus: 'confirmed',
    });
    await h.sql`
      INSERT INTO valet_jobs (
        booking_id, driver_user_id, assigned_user_id, status,
        pickup_location, pickup_address, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, ${userId}, 'en_route',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
        'somewhere', 0.200
      )
    `;
  }

  return userId;
}

const find = (radiusM = 5000) =>
  assignment.findCandidates({
    origin: originFromPoint(ORIGIN.lat, ORIGIN.lng),
    radiusM,
    excludeUserId: h.driverId,
    jobId: null,
  });

beforeAll(async () => {
  h = await startHarness();
  assignment = new AssignmentService(h.db);
  spaceId = await seedSpace(h, {
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    pricing: HOURLY_ONLY,
    schedule: OPEN_ALWAYS,
    slots: { car: 8 },
  });
}, 180_000);

afterAll(async () => {
  await stopHarness(h);
});

beforeEach(async () => {
  await h.sql`
    TRUNCATE bookings, booking_slots, valet_jobs, valet_job_offers, valet_profiles
    RESTART IDENTITY CASCADE
  `;
  vi.restoreAllMocks();
});

describe('distance and the radius', () => {
  it('offers only the valets inside the radius, nearest first', async () => {
    await seedValet({ metresAway: 3000 });
    await seedValet({ metresAway: 1000 });
    await seedValet({ metresAway: 9000 });
    await seedValet({ metresAway: 4900 });
    await seedValet({ metresAway: 5100 });

    const candidates = await find(5000);

    expect(candidates).toHaveLength(3);
    const distances = candidates.map((c) => Math.round(c.distanceM / 100) * 100);
    expect(distances).toEqual([1000, 3000, 4900]);
    // Ascending, asserted as a property rather than by reading the literals.
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('caps the fan-out at five even when twelve are eligible', async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedValet({ metresAway: 200 + i * 100 });
    }

    const candidates = await find(5000);

    expect(candidates).toHaveLength(OFFER_FANOUT);
    expect(OFFER_FANOUT).toBe(5);
  });
});

describe('the six filters beyond distance', () => {
  /**
   * Each case seeds exactly one valet, who is eligible in every respect except
   * the named one. An empty result is therefore attributable to that filter and
   * to nothing else.
   */
  it.each([
    ['unverified', { verification: 'pending' }],
    ['offline', { isOnline: false }],
    ['stale heartbeat', { lastSeenSecondsAgo: ONLINE_HEARTBEAT_WINDOW_SECONDS + 30 }],
    ['expired licence', { licenceExpiresInDays: -1 }],
    ['inactive valet role', { roleStatus: 'pending' }],
    ['blocked user account', { userStatus: 'blocked' }],
    ['already on a live job', { onLiveJob: true }],
  ])('excludes a valet who is %s', async (_label, overrides) => {
    await seedValet({ metresAway: 500, ...overrides });

    expect(await find(5000)).toEqual([]);
  });

  it('includes that same valet once the disqualifying fact is removed', async () => {
    // The control. Without it, every case above could be passing because the
    // fixture is broken rather than because the filter works.
    await seedValet({ metresAway: 500 });

    expect(await find(5000)).toHaveLength(1);
  });

  it('accepts a null licence expiry as "no expiry on file", not as expired', async () => {
    await seedValet({ metresAway: 500, licenceExpiresInDays: null });

    expect(await find(5000)).toHaveLength(1);
  });

  it('never offers a job to the requesting driver', async () => {
    await h.sql`
      INSERT INTO valet_profiles (user_id, verification_status, is_online, last_seen_at, current_location, rating_count)
      VALUES (${h.driverId}, 'verified', true, now(), ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography, 0)
    `;
    await h.sql`INSERT INTO user_roles (user_id, role) VALUES (${h.driverId}, 'valet')`;

    expect(await find(5000)).toEqual([]);
  });
});

describe('the rating floor', () => {
  /** The assertion v1 would have failed: it ordered by distance alone. */
  it('excludes a 3.1-star valet at 400 m in favour of two further-away valets above the floor', async () => {
    const low = await seedValet({ metresAway: 400, ratingAvgBp: 31_000 });
    const excellent = await seedValet({ metresAway: 900, ratingAvgBp: 48_000 });
    const good = await seedValet({ metresAway: 1500, ratingAvgBp: 42_000 });

    const candidates = await find(5000);

    expect(candidates.map((c) => c.userId)).toEqual([excellent, good]);
    expect(candidates.map((c) => c.userId)).not.toContain(low);
  });

  it('offers everyone when nobody clears the floor, and says so at warn', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    await seedValet({ metresAway: 600, ratingAvgBp: 29_000 });
    await seedValet({ metresAway: 900, ratingAvgBp: 34_000 });

    const candidates = await find(5000);

    expect(candidates).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);

    const [context, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('valet assignment fell back below the rating floor');
    expect(context['radiusM']).toBe(5000);
    expect(context['ratingFloorBp']).toBe(PARTNER_RATING_FLOOR_BP);
    expect(context['fallbackCandidates']).toBe(2);
    expect(context['lowestRatingBp']).toBe(29_000);
  });

  /**
   * A new partner cannot be starved of the jobs that would rate them. And they
   * clear the floor in the *first* pass, so their presence is not reported as a
   * supply problem — `rating_count = 0` means unrated, not "sitting on 3.5".
   */
  it('offers an unrated valet without emitting the fallback warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const fresh = await seedValet({ metresAway: 700, ratingAvgBp: null, ratingCount: 0 });

    const candidates = await find(5000);

    expect(candidates.map((c) => c.userId)).toEqual([fresh]);
    expect(candidates[0]?.ratingAvgBp).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ranks an unrated valet by distance alongside rated ones, not below them', async () => {
    const unrated = await seedValet({ metresAway: 300, ratingAvgBp: null, ratingCount: 0 });
    const rated = await seedValet({ metresAway: 1200, ratingAvgBp: 47_000 });

    expect((await find(5000)).map((c) => c.userId)).toEqual([unrated, rated]);
  });

  it('treats the floor as inclusive — exactly 3.5 stars clears it', async () => {
    const onTheLine = await seedValet({ metresAway: 500, ratingAvgBp: PARTNER_RATING_FLOOR_BP });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    expect((await find(5000)).map((c) => c.userId)).toEqual([onTheLine]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the v1 origin bug', () => {
  /**
   * v1 read `job.pickupLocation.lng` off a geography column, which a raw driver
   * read returns as WKB hex — so `.lng` was `undefined` and every widened search
   * ran from `POINT(undefined undefined)`, off the coast of Africa.
   *
   * This builds the origin the way the worker does, from a job row read back out
   * of the database, and asserts it still finds the valet standing next to it.
   */
  it('searches from the stored pickup point, not from nowhere', async () => {
    const near = await seedValet({ metresAway: 800 });
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });

    const [job] = await h.sql<{ id: string }[]>`
      INSERT INTO valet_jobs (
        booking_id, driver_user_id, status, pickup_location, pickup_address, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, 'requested',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
        'Forum Mall', 0.200
      )
      RETURNING id
    `;

    const candidates = await assignment.findCandidates({
      origin: originFromJobPickup(job!.id),
      radiusM: 5000,
      excludeUserId: h.driverId,
      jobId: job!.id,
    });

    expect(candidates.map((c) => c.userId)).toEqual([near]);
    expect(candidates[0]?.distanceM).toBeGreaterThan(700);
    expect(candidates[0]?.distanceM).toBeLessThan(900);
  });

  it('excludes anyone already offered this job, so a widened round does not re-ask', async () => {
    const first = await seedValet({ metresAway: 400 });
    const second = await seedValet({ metresAway: 1600 });
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });

    const [job] = await h.sql<{ id: string }[]>`
      INSERT INTO valet_jobs (
        booking_id, driver_user_id, status, pickup_location, pickup_address, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, 'offered',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
        'Forum Mall', 0.200
      )
      RETURNING id
    `;
    await h.sql`
      INSERT INTO valet_job_offers (job_id, valet_user_id, distance_m, outcome)
      VALUES (${job!.id}, ${first}, 400, 'pending')
    `;

    const candidates = await assignment.findCandidates({
      origin: originFromJobPickup(job!.id),
      radiusM: 12_000,
      excludeUserId: h.driverId,
      jobId: job!.id,
    });

    expect(candidates.map((c) => c.userId)).toEqual([second]);
  });
});

describe('index usage (R-PERF-01)', () => {
  /**
   * Seeded at a realistic scale on purpose.
   *
   * On an empty or near-empty table the planner correctly prefers a sequential
   * scan, so an EXPLAIN there proves nothing about production — it would pass
   * whether or not the index existed. 600 online valets across the city is the
   * smallest fixture that makes the index the cheaper plan on its own merits.
   */
  it('uses the partial GiST index and never sequentially scans valet_profiles', async () => {
    const rows: string[] = [];
    for (let i = 0; i < 600; i += 1) {
      rows.push(String(i));
    }

    // One statement rather than 600 round trips: generate_series builds the
    // spread directly in SQL.
    const users = await h.sql<{ id: string }[]>`
      INSERT INTO users (phone, firebase_uid, name)
      SELECT '+9199' || lpad(g::text, 8, '0'), 'fb-perf-' || g, 'perf valet ' || g
      FROM generate_series(1, ${rows.length}) g
      RETURNING id
    `;
    await h.sql`
      INSERT INTO user_roles (user_id, role, status)
      SELECT id, 'valet', 'active' FROM unnest(${users.map((u) => u.id)}::uuid[]) AS id
    `;
    await h.sql`
      INSERT INTO valet_profiles (
        user_id, verification_status, is_online, last_seen_at, current_location, rating_count
      )
      SELECT id,
             'verified', true, now(),
             ST_SetSRID(
               ST_MakePoint(
                 ${ORIGIN.lng} + ((random() - 0.5) * 0.6),
                 ${ORIGIN.lat} + ((random() - 0.5) * 0.6)
               ), 4326
             )::geography,
             0
      FROM unnest(${users.map((u) => u.id)}::uuid[]) AS id
    `;
    // Every table the planner joins, not just the one under test: stale
    // statistics on `users` or `user_roles` change the join order and would make
    // this assert something about the fixture rather than about the query.
    await h.sql`ANALYZE valet_profiles, users, user_roles, valet_jobs`;

    const explained = await h.db.execute(sql`
      EXPLAIN (ANALYZE, BUFFERS)
      ${valetCandidateQuery({
        origin: originFromPoint(ORIGIN.lat, ORIGIN.lng),
        radiusM: 5000,
        excludeUserId: h.driverId,
        jobId: null,
        minRatingBp: PARTNER_RATING_FLOOR_BP,
        limit: OFFER_FANOUT,
        heartbeatWindowSeconds: ONLINE_HEARTBEAT_WINDOW_SECONDS,
      })}
    `);

    const plan = [...explained]
      .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');

    // A GiST spatial lookup plans as a plain Index Scan or a Bitmap Index Scan
    // depending on selectivity; both are index-backed, so assert the index is
    // used and let the planner pick its access method.
    expect(plan).toMatch(
      /(Bitmap )?Index Scan on valet_profiles_current_location_gix|Index Scan using valet_profiles_current_location_gix/,
    );
    // The requirement that actually matters. \b stops this matching
    // "Seq Scan on valet_profiles_something_else".
    expect(plan).not.toMatch(/Seq Scan on valet_profiles\b/);
  });
});
