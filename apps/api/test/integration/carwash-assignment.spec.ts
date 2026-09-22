import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import { WASH_OFFER_FANOUT, WASH_OFFER_RADII_M } from '@parkease/contracts/washer';
import { originFromPoint } from '@parkease/db/queries';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WashAssignmentService } from '../../src/domains/carwash/assignment.service.js';
import { logger } from '../../src/platform/observability/logger.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * The car wash candidate search, against real PostGIS.
 *
 * Distances are seeded as offsets in degrees from a fixed origin and then
 * asserted in metres as PostGIS computes them — no haversine in the test
 * either, or it would be checking its own arithmetic rather than the query's.
 */

const ORIGIN = { lat: 12.9352, lng: 77.6245 };

/** Degrees of longitude per metre at this latitude, near enough for fixtures. */
const DEG_PER_M = 1 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));

const FIRST_RADIUS_M = WASH_OFFER_RADII_M[0];

let h: Harness;
let assignment: WashAssignmentService;

interface SeedWasherOptions {
  readonly metresAway: number;
  readonly ratingAvgBp?: number | null;
  readonly ratingCount?: number;
  readonly verification?: string;
  readonly isOnline?: boolean;
  readonly lastSeenSecondsAgo?: number;
  readonly roleStatus?: string;
  readonly userStatus?: string;
  readonly onLiveJob?: boolean;
  /** Which `(service, vehicle)` pairs this partner prices. Default: premium car. */
  readonly menu?: readonly { service: string; vehicle: string; active?: boolean }[];
}

async function seedWasher(opts: SeedWasherOptions): Promise<string> {
  const userId = await seedUser(h, 'washer');
  const lng = ORIGIN.lng + opts.metresAway * DEG_PER_M;
  const ratingCount = opts.ratingCount ?? (opts.ratingAvgBp == null ? 0 : 5);

  await h.sql`
    INSERT INTO washer_profiles (
      user_id, partner_type, verification_status, is_online, last_seen_at,
      current_location, rating_avg_bp, rating_count
    )
    VALUES (
      ${userId}, 'gig',
      ${opts.verification ?? 'verified'},
      ${opts.isOnline ?? true},
      now() - make_interval(secs => ${opts.lastSeenSecondsAgo ?? 5}),
      ST_SetSRID(ST_MakePoint(${lng}, ${ORIGIN.lat}), 4326)::geography,
      ${opts.ratingAvgBp ?? null},
      ${ratingCount}
    )
  `;

  if (opts.roleStatus !== undefined) {
    await h.sql`
      UPDATE user_roles SET status = ${opts.roleStatus}
      WHERE user_id = ${userId} AND role = 'washer'
    `;
  }
  if (opts.userStatus !== undefined) {
    await h.sql`UPDATE users SET status = ${opts.userStatus} WHERE id = ${userId}`;
  }

  const menu = opts.menu ?? [{ service: 'premium_wash', vehicle: 'car' }];
  for (const row of menu) {
    await h.sql`
      INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes, is_active)
      VALUES (${userId}, ${row.service}, ${row.vehicle}, 39900, 40, ${row.active ?? true})
    `;
  }

  if (opts.onLiveJob === true) {
    const bookingId = await seedActiveBooking();
    await h.sql`
      INSERT INTO wash_jobs (
        booking_id, driver_user_id, washer_user_id, status, service_name, vehicle_type,
        space_location, price_paise, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, ${userId}, 'accepted', 'premium_wash', 'car',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
        39900, 0.200
      )
    `;
  }

  return userId;
}

let spaceId: string;

async function seedActiveBooking(): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    INSERT INTO bookings (
      driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
      base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
      owner_earnings_paise
    )
    VALUES (
      ${h.driverId}, ${spaceId}, 'car', 'hourly',
      now() - interval '5 minutes', now() + interval '55 minutes', 'active',
      3000, 0, 450, 0, 3000, 2550
    )
    RETURNING id
  `;
  if (row === undefined) throw new Error('failed to seed booking');
  return row.id;
}

const find = (overrides: Partial<Parameters<WashAssignmentService['findCandidates']>[0]> = {}) =>
  assignment.findCandidates({
    origin: originFromPoint(ORIGIN.lat, ORIGIN.lng),
    radiusM: FIRST_RADIUS_M,
    excludeUserId: h.driverId,
    jobId: null,
    serviceName: 'premium_wash',
    vehicleType: 'car',
    ...overrides,
  });

beforeAll(async () => {
  h = await startHarness();
  assignment = new WashAssignmentService(h.db);

  const [space] = await h.sql<{ id: string }[]>`
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status
    ) VALUES (
      ${h.ownerId}, 'Basement Parking', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
      ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
      ST_GeoHash(ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geometry, 6),
      ${JSON.stringify({ car: { hourlyPaise: 3000 } })}::jsonb,
      ${JSON.stringify({ is24x7: true })}::jsonb,
      '[]'::jsonb, 'active'
    ) RETURNING id
  `;
  spaceId = space!.id;
}, 300_000);

afterAll(async () => {
  if (h) await stopHarness(h);
}, 30_000);

beforeEach(async () => {
  await h.sql`
    TRUNCATE wash_job_offers, wash_jobs, wash_services, washer_profiles,
             ledger_entries, outbox_messages, bookings, booking_slots
    RESTART IDENTITY CASCADE
  `;
  vi.restoreAllMocks();
});

describe('distance', () => {
  it('offers only the partners inside the first radius', async () => {
    const near = await seedWasher({ metresAway: 1_000 });
    const edge = await seedWasher({ metresAway: 2_900 });
    await seedWasher({ metresAway: 3_100 });
    await seedWasher({ metresAway: 6_000 });

    const found = await find();

    expect(found.map((c) => c.userId).sort()).toEqual([near, edge].sort());
  });

  it('returns them nearest first', async () => {
    const far = await seedWasher({ metresAway: 2_500 });
    const near = await seedWasher({ metresAway: 400 });

    const found = await find();

    expect(found.map((c) => c.userId)).toEqual([near, far]);
  });

  it('caps the fan-out at three', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedWasher({ metresAway: 100 * (i + 1) });
    }

    expect(await find()).toHaveLength(WASH_OFFER_FANOUT);
  });

  /**
   * R-PERF-01. Without the GiST index every dispatch is a sequential scan over
   * every partner in the country, and the query would still return the right
   * answer — which is exactly why this is asserted on the plan rather than on
   * the result.
   */
  it('uses the GiST index rather than scanning every partner', async () => {
    await seedWasher({ metresAway: 500 });

    const plan = await h.sql<{ 'QUERY PLAN': string }[]>`
      EXPLAIN ANALYZE
      SELECT wp.user_id
      FROM washer_profiles wp
      WHERE wp.current_location IS NOT NULL
        AND ST_DWithin(
              wp.current_location,
              ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
              ${FIRST_RADIUS_M}
            )
    `;

    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('washer_profiles_current_location_gix');
  });
});

describe('eligibility', () => {
  it('excludes a partner who is not verified', async () => {
    await seedWasher({ metresAway: 500, verification: 'pending' });
    expect(await find()).toHaveLength(0);
  });

  it('excludes a partner who is offline', async () => {
    await seedWasher({ metresAway: 500, isOnline: false });
    expect(await find()).toHaveLength(0);
  });

  /**
   * `is_online` alone means "willing", not "reachable": a phone that lost
   * connectivity keeps the flag set. The heartbeat is what makes the difference.
   */
  it('excludes a partner whose heartbeat is stale', async () => {
    await seedWasher({ metresAway: 500, lastSeenSecondsAgo: 300 });
    expect(await find()).toHaveLength(0);
  });

  it('excludes a partner whose role is not active', async () => {
    await seedWasher({ metresAway: 500, roleStatus: 'suspended' });
    expect(await find()).toHaveLength(0);
  });

  it('excludes a partner whose account is blocked', async () => {
    await seedWasher({ metresAway: 500, userStatus: 'blocked' });
    expect(await find()).toHaveLength(0);
  });

  it('excludes a partner already on a live job', async () => {
    await seedWasher({ metresAway: 500, onLiveJob: true });
    expect(await find()).toHaveLength(0);
  });

  it('excludes the driver from their own offer set', async () => {
    const driverAsWasher = await seedWasher({ metresAway: 500 });
    expect(await find({ excludeUserId: driverAsWasher })).toHaveLength(0);
  });
});

/**
 * The filter this query has and the valet one does not. §13.4.
 */
describe('the service menu decides eligibility', () => {
  it('excludes a partner who does not offer the service at all', async () => {
    await seedWasher({ metresAway: 500, menu: [{ service: 'quick_wipe', vehicle: 'car' }] });
    expect(await find()).toHaveLength(0);
  });

  it('excludes a partner who offers the service for the other vehicle type', async () => {
    await seedWasher({
      metresAway: 500,
      menu: [{ service: 'premium_wash', vehicle: 'two_wheeler' }],
    });
    expect(await find()).toHaveLength(0);
  });

  it('offers a partner who prices exactly the requested pair', async () => {
    const washerId = await seedWasher({
      metresAway: 500,
      menu: [
        { service: 'premium_wash', vehicle: 'car' },
        { service: 'quick_wipe', vehicle: 'two_wheeler' },
      ],
    });

    expect((await find()).map((c) => c.userId)).toEqual([washerId]);
  });

  /** A deactivated row is not a cheaper row — it is no row. */
  it('excludes a partner whose menu row is inactive', async () => {
    await seedWasher({
      metresAway: 500,
      menu: [{ service: 'premium_wash', vehicle: 'car', active: false }],
    });
    expect(await find()).toHaveLength(0);
  });

  it('carries the partner own price back, because the push quotes it', async () => {
    await seedWasher({ metresAway: 500 });

    const [candidate] = await find();
    expect(candidate?.pricePaise).toBe(39900);
    expect(candidate?.durationMinutes).toBe(40);
  });
});

describe('the rating floor', () => {
  it('prefers a partner above the floor over a closer one below it', async () => {
    await seedWasher({ metresAway: 500, ratingAvgBp: 34_000 });
    const good = await seedWasher({ metresAway: 2_000, ratingAvgBp: 45_000 });

    expect((await find()).map((c) => c.userId)).toEqual([good]);
  });

  it('falls back to everybody when nobody clears the floor, and says so', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const low = await seedWasher({ metresAway: 500, ratingAvgBp: 34_000 });
    const lower = await seedWasher({ metresAway: 900, ratingAvgBp: 21_000 });

    const found = await find();

    expect(found.map((c) => c.userId).sort()).toEqual([low, lower].sort());
    expect(warn).toHaveBeenCalledTimes(1);

    const [fields] = warn.mock.calls[0] ?? [];
    expect(fields).toMatchObject({
      ratingFloorBp: PARTNER_RATING_FLOOR_BP,
      fallbackCandidates: 2,
      lowestRatingBp: 21_000,
      serviceName: 'premium_wash',
    });
  });

  it('does not warn when the floored pass found somebody', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    await seedWasher({ metresAway: 500, ratingAvgBp: 45_000 });

    await find();

    expect(warn).not.toHaveBeenCalled();
  });

  /**
   * A new partner cannot be starved of the jobs that would rate them, so an
   * unrated one clears the floor in the *first* pass rather than falling to the
   * documented fallback — and their presence is not a supply problem worth
   * warning about.
   */
  it('treats an unrated partner as eligible without a fallback warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const fresh = await seedWasher({ metresAway: 500, ratingAvgBp: null, ratingCount: 0 });

    expect((await find()).map((c) => c.userId)).toEqual([fresh]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('offers already made', () => {
  it('excludes a partner who has already seen this job', async () => {
    const washerId = await seedWasher({ metresAway: 500 });
    const bookingId = await seedActiveBooking();

    const [job] = await h.sql<{ id: string }[]>`
      INSERT INTO wash_jobs (
        booking_id, driver_user_id, status, service_name, vehicle_type,
        space_location, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, 'offered', 'premium_wash', 'car',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography, 0.200
      )
      RETURNING id
    `;
    await h.sql`
      INSERT INTO wash_job_offers (job_id, washer_user_id, distance_m)
      VALUES (${job!.id}, ${washerId}, 500)
    `;

    expect(await find({ jobId: job!.id })).toHaveLength(0);
  });

  /**
   * The unique key makes the anti-join unbypassable: even if the query were
   * wrong, a widened round could not re-offer to somebody who already saw this
   * job.
   */
  it('refuses a second offer row for the same partner and job', async () => {
    const washerId = await seedWasher({ metresAway: 500 });
    const bookingId = await seedActiveBooking();

    const [job] = await h.sql<{ id: string }[]>`
      INSERT INTO wash_jobs (
        booking_id, driver_user_id, status, service_name, vehicle_type,
        space_location, commission_rate
      )
      VALUES (
        ${bookingId}, ${h.driverId}, 'offered', 'premium_wash', 'car',
        ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography, 0.200
      )
      RETURNING id
    `;
    await h.sql`
      INSERT INTO wash_job_offers (job_id, washer_user_id, distance_m)
      VALUES (${job!.id}, ${washerId}, 500)
    `;

    await expect(
      h.sql`
        INSERT INTO wash_job_offers (job_id, washer_user_id, distance_m)
        VALUES (${job!.id}, ${washerId}, 900)
      `,
    ).rejects.toThrow(/wash_job_offers_job_washer_key/);
  });
});
