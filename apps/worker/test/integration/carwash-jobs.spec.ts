import { CARWASH_COMMISSION_RATE } from '@parkease/contracts/money';
import { WASH_OFFER_RADII_M } from '@parkease/contracts/washer';
import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { acceptTimeout } from '../../src/jobs/carwash/accept-timeout.job.js';
import { washCompleteReminder } from '../../src/jobs/carwash/wash-complete-reminder.job.js';

let pg: PgTestContext;
let deps: JobDeps;

const ORIGIN = { lat: 12.9352, lng: 77.6245 };
const DEG_PER_M = 1 / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));

let driverId: string;
let spaceId: string;

const unique = () => String(Math.floor(Math.random() * 90_000_000) + 10_000_000);

async function seedUser(name: string): Promise<string> {
  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name)
    VALUES (${`+9198${unique()}`}, ${`fb-${String(Math.random())}`}, ${name})
    RETURNING id
  `;
  if (row === undefined) throw new Error('failed to seed user');
  return row.id;
}

async function seedWasher(metresAway: number): Promise<string> {
  const userId = await seedUser('Washer');
  await pg.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${userId}, 'washer', 'active')`;
  await pg.sql`
    INSERT INTO washer_profiles (
      user_id, partner_type, verification_status, is_online, last_seen_at,
      current_location, rating_count
    )
    VALUES (
      ${userId}, 'gig', 'verified', true, now(),
      ST_SetSRID(ST_MakePoint(${ORIGIN.lng + metresAway * DEG_PER_M}, ${ORIGIN.lat}), 4326)::geography,
      0
    )
  `;
  await pg.sql`
    INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
    VALUES (${userId}, 'premium_wash', 'car', 39900, 40)
  `;
  return userId;
}

async function seedBooking(): Promise<string> {
  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO bookings (
      driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
      base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
      owner_earnings_paise
    )
    VALUES (
      ${driverId}, ${spaceId}, 'car', 'hourly',
      now() - interval '5 minutes', now() + interval '55 minutes', 'active',
      3000, 0, 450, 0, 3000, 2550
    )
    RETURNING id
  `;
  if (row === undefined) throw new Error('failed to seed booking');
  return row.id;
}

interface SeedJobOptions {
  readonly status: string;
  readonly offerRound?: number;
  readonly washerUserId?: string;
  readonly offerRadiusM?: number;
}

/** A wash job in a given state, written directly — the worker has no commands. */
async function seedJob(opts: SeedJobOptions): Promise<string> {
  const bookingId = await seedBooking();
  const assigned = opts.washerUserId ?? null;
  /**
   * `wash_jobs_assignee_presence_check` moves all three together: a job with a
   * partner has a price *and* a ledger link. Seeding two of the three would be
   * seeding a state production cannot reach.
   */
  const pricePaise = assigned === null ? null : 39900;

  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO wash_jobs (
      booking_id, driver_user_id, washer_user_id, status,
      service_name, vehicle_type, space_location, price_paise, commission_rate,
      txn_id, offer_radius_m, offer_round, before_photo_id, after_photo_id
    )
    VALUES (
      ${bookingId}, ${driverId}, ${assigned}, ${opts.status},
      'premium_wash', 'car',
      ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
      ${pricePaise}, ${CARWASH_COMMISSION_RATE.toFixed(3)},
      ${assigned === null ? null : pg.sql`uuidv7()`},
      ${opts.offerRadiusM ?? WASH_OFFER_RADII_M[0]}, ${opts.offerRound ?? 0},
      ${opts.status === 'washing' || opts.status === 'completed' ? 'wash/before/x' : null},
      ${opts.status === 'completed' ? 'wash/after/x' : null}
    )
    RETURNING id
  `;
  if (row === undefined) throw new Error('failed to seed wash job');
  return row.id;
}

const jobRow = async (jobId: string) => {
  const [row] = await pg.sql<
    {
      status: string;
      offer_round: number;
      offer_radius_m: number;
      cancellation_reason: string | null;
    }[]
  >`
    SELECT status, offer_round, offer_radius_m, cancellation_reason
    FROM wash_jobs WHERE id = ${jobId}
  `;
  if (row === undefined) throw new Error('job vanished');
  return row;
};

const outboxTypes = async (): Promise<string[]> => {
  const rows = await pg.sql<{ type: string }[]>`SELECT type FROM outbox_messages ORDER BY type`;
  return rows.map((r) => r.type);
};

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    // Neither car wash job touches the cache.
    redis: {} as JobDeps['redis'],
  };

  driverId = await seedUser('Ravi K.');
  const ownerId = await seedUser('Priya S.');
  const [space] = await pg.sql<{ id: string }[]>`
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status
    ) VALUES (
      ${ownerId}, 'Basement Parking', '5th Cross', 'Bengaluru', 'Karnataka', '560034',
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
  await stopPgContainer(pg);
});

beforeEach(async () => {
  // TRUNCATE, not DELETE: `ledger_entries` carries a BEFORE DELETE trigger that
  // refuses row deletion outright (R-MONEY-07), and TRUNCATE does not fire row
  // triggers.
  await pg.sql`
    TRUNCATE wash_job_offers, wash_jobs, wash_services, washer_profiles,
             ledger_entries, outbox_messages, bookings, booking_slots
    RESTART IDENTITY CASCADE
  `;
  // The mid-search race tests spy on `deps.db.execute`; leaving one installed
  // would silently re-run its accept in whatever test came next.
  vi.restoreAllMocks();
});

describe('carwash.accept-timeout', () => {
  it('widens to the next radius and offers the partners it finds', async () => {
    const washerId = await seedWasher(4_000); // outside 3 km, inside 5 km
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });

    const row = await jobRow(jobId);
    expect(row.status).toBe('offered');
    expect(row.offer_round).toBe(1);
    expect(row.offer_radius_m).toBe(WASH_OFFER_RADII_M[1]);

    const offers = await pg.sql<{ washer_user_id: string; offer_round: number }[]>`
      SELECT washer_user_id, offer_round FROM wash_job_offers WHERE job_id = ${jobId}
    `;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.washer_user_id).toBe(washerId);
    expect(offers[0]?.offer_round).toBe(1);
  });

  /**
   * The partner's own price, from their own menu row. A job-level figure would
   * be wrong for two of every three partners in a fan-out.
   */
  it('quotes the partner their own earnings, not the price', async () => {
    await seedWasher(4_000);
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });

    const [message] = await pg.sql<{ payload: { data: { earningsPaise: number } } }[]>`
      SELECT payload FROM outbox_messages WHERE type = 'notification.dispatch'
    `;
    // 39900 less 20% commission.
    expect(message?.payload.data.earningsPaise).toBe(31920);
  });

  it('schedules the next timeout for the widened round', async () => {
    await seedWasher(4_000);
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });

    const [timeout] = await pg.sql<{ payload: { round: number } }[]>`
      SELECT payload FROM outbox_messages WHERE type = 'carwash.accept-timeout'
    `;
    expect(timeout?.payload.round).toBe(1);
  });

  it('widens even when nobody is found, so the ladder keeps climbing', async () => {
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });

    const row = await jobRow(jobId);
    expect(row.offer_round).toBe(1);
    expect(await outboxTypes()).toEqual(['carwash.accept-timeout']);
  });

  it('gives up after the last radius and cancels with a reason', async () => {
    const jobId = await seedJob({
      status: 'offered',
      offerRound: WASH_OFFER_RADII_M.length - 1,
    });

    await acceptTimeout(deps, { jobId, round: WASH_OFFER_RADII_M.length - 1 });

    const row = await jobRow(jobId);
    expect(row.status).toBe('cancelled');
    expect(row.cancellation_reason).toBe('no_washer_available');
    expect(await outboxTypes()).toEqual(['notification.dispatch']);
  });

  /**
   * No ledger entries exist for an unaccepted job: nobody was assigned, so
   * nobody was dispatched, so nobody is owed. The absence is the posting.
   */
  it('posts nothing to the ledger when it gives up', async () => {
    const jobId = await seedJob({
      status: 'offered',
      offerRound: WASH_OFFER_RADII_M.length - 1,
    });

    await acceptTimeout(deps, { jobId, round: WASH_OFFER_RADII_M.length - 1 });

    const entries = await pg.sql`SELECT 1 FROM ledger_entries`;
    expect(entries).toHaveLength(0);
  });

  describe('stale deliveries, which are normal rather than errors', () => {
    it('does nothing when the job no longer exists', async () => {
      await expect(
        acceptTimeout(deps, { jobId: '0192f3a1-0000-7000-8000-000000000001', round: 0 }),
      ).resolves.toBeUndefined();
    });

    it('does nothing when somebody already accepted', async () => {
      const washerId = await seedWasher(1_000);
      const jobId = await seedJob({ status: 'accepted', washerUserId: washerId });

      await acceptTimeout(deps, { jobId, round: 0 });

      expect((await jobRow(jobId)).status).toBe('accepted');
      expect(await outboxTypes()).toEqual([]);
    });

    it('does nothing when the delivered round is behind the live one', async () => {
      const jobId = await seedJob({ status: 'offered', offerRound: 2 });

      await acceptTimeout(deps, { jobId, round: 0 });

      expect((await jobRow(jobId)).offer_round).toBe(2);
      expect(await outboxTypes()).toEqual([]);
    });
  });

  /**
   * The race the pinned WHERE exists for.
   *
   * The handler reads the job, then runs a PostGIS candidate search that takes
   * real time, and only then writes. A partner accepting inside that window
   * must win — an UPDATE matching on `id` alone would put an accepted job back
   * to `offered`, or bury it under `no_washer_available`, on top of a frozen
   * price and four ledger entries.
   *
   * Simulated by moving the row after the handler has read it, which is what a
   * concurrent accept does.
   */
  describe('an accept landing mid-search wins', () => {
    /**
     * The accept has to land *after* the handler's guards and *before* its
     * write, or the guards catch it and the pinned WHERE is never exercised —
     * a test that moved the row up front would pass with or without the fix.
     *
     * `deps.db.execute` is the seam: the handler calls it for the PostGIS
     * candidate query, which is exactly the slow window the race lives in.
     */
    const acceptDuringCandidateSearch = async (jobId: string, washerId: string) => {
      const realExecute = deps.db.execute.bind(deps.db) as (query: unknown) => Promise<unknown>;
      let moved = false;

      const spy = vi.spyOn(deps.db, 'execute') as unknown as {
        mockImplementation: (fn: (query: unknown) => Promise<unknown>) => void;
      };

      spy.mockImplementation(async (query: unknown) => {
        if (!moved) {
          moved = true;
          await pg.sql`
            UPDATE wash_jobs
            SET status = 'accepted', washer_user_id = ${washerId},
                price_paise = 39900, txn_id = uuidv7()
            WHERE id = ${jobId}
          `;
        }
        return realExecute(query);
      });
    };

    it('does not re-offer a job accepted while it was searching', async () => {
      const washerId = await seedWasher(4_000);
      const jobId = await seedJob({ status: 'offered', offerRound: 0 });
      await acceptDuringCandidateSearch(jobId, washerId);

      await acceptTimeout(deps, { jobId, round: 0 });

      const row = await jobRow(jobId);
      expect(row.status).toBe('accepted');
      expect(row.offer_round).toBe(0);
      expect(row.offer_radius_m).toBe(WASH_OFFER_RADII_M[0]);

      // No second timeout scheduled, and no partner told about a job that is
      // already taken.
      expect(await outboxTypes()).toEqual([]);
    });

    it('does not bury an accepted job under no_washer_available', async () => {
      const washerId = await seedWasher(1_000);
      const jobId = await seedJob({
        status: 'offered',
        offerRound: WASH_OFFER_RADII_M.length - 1,
      });

      /**
       * `giveUp` runs no candidate query, so `db.execute` is not the seam here
       * — `db.transaction` is. The accept is staged just before the handler
       * opens its transaction, which is after its guards have already passed.
       *
       * Staging it any earlier would be tested by the guards instead of by the
       * pinned WHERE, and the test would pass with the fix reverted. It does
       * not: removing `eq(washJobs.status, job.status)` from `giveUp` turns
       * this red.
       *
       * `cancelled` is the one status `wash_jobs_assignee_presence_check` does
       * not constrain, so nothing but that WHERE stands between an accepted job
       * and being buried under `no_washer_available`.
       */
      const realTransaction = deps.db.transaction.bind(deps.db) as (
        fn: unknown,
      ) => Promise<unknown>;
      const txSpy = vi.spyOn(deps.db, 'transaction') as unknown as {
        mockImplementation: (fn: (body: unknown) => Promise<unknown>) => void;
      };
      txSpy.mockImplementation(async (body: unknown) => {
        await pg.sql`
          UPDATE wash_jobs
          SET status = 'accepted', washer_user_id = ${washerId},
              price_paise = 39900, txn_id = uuidv7()
          WHERE id = ${jobId}
        `;
        return realTransaction(body);
      });

      // The handler is still holding the row as it read it, at `offered`.
      await acceptTimeout(deps, { jobId, round: WASH_OFFER_RADII_M.length - 1 });

      const row = await jobRow(jobId);
      expect(row.status).toBe('accepted');
      expect(row.cancellation_reason).toBeNull();
      // And the driver is not told nobody took it.
      expect(await outboxTypes()).toEqual([]);
    });
  });

  it('refuses a payload that is not a job id and a round', async () => {
    await expect(acceptTimeout(deps, { jobId: 'not-a-uuid', round: 0 })).rejects.toThrow(
      /Malformed car wash job payload/,
    );
    await expect(acceptTimeout(deps, {})).rejects.toThrow(/Malformed car wash job payload/);
  });
});

describe('carwash.complete-reminder', () => {
  it('nudges a partner who is still washing', async () => {
    const washerId = await seedWasher(1_000);
    const jobId = await seedJob({ status: 'washing', washerUserId: washerId });

    await washCompleteReminder(deps, { jobId });

    const [message] = await pg.sql<{ payload: { userId: string; template: string } }[]>`
      SELECT payload FROM outbox_messages WHERE type = 'notification.dispatch'
    `;
    expect(message?.payload.userId).toBe(washerId);
    expect(message?.payload.template).toBe('washer.complete_reminder');
  });

  /**
   * A redelivery after the partner finished must not ask somebody who is done
   * whether they are done.
   */
  it('says nothing once the job is completed', async () => {
    const washerId = await seedWasher(1_000);
    const jobId = await seedJob({ status: 'completed', washerUserId: washerId });

    await washCompleteReminder(deps, { jobId });

    expect(await outboxTypes()).toEqual([]);
  });

  it('says nothing when the job no longer exists', async () => {
    await expect(
      washCompleteReminder(deps, { jobId: '0192f3a1-0000-7000-8000-000000000002' }),
    ).resolves.toBeUndefined();
  });

  it('refuses a malformed payload', async () => {
    await expect(washCompleteReminder(deps, { jobId: 'nope' })).rejects.toThrow(
      /Malformed car wash job payload/,
    );
  });
});
