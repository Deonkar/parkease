import { VALET_COMMISSION_RATE } from '@parkease/contracts/money';
import { NO_SHOW_GRACE_MS } from '@parkease/contracts/valet';
import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { acceptTimeout } from '../../src/jobs/valet/accept-timeout.job.js';
import { noShow } from '../../src/jobs/valet/no-show.job.js';

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

async function seedValet(metresAway: number): Promise<string> {
  const userId = await seedUser('Valet');
  await pg.sql`INSERT INTO user_roles (user_id, role, status) VALUES (${userId}, 'valet', 'active')`;
  await pg.sql`
    INSERT INTO valet_profiles (
      user_id, verification_status, is_online, last_seen_at, current_location, rating_count
    )
    VALUES (
      ${userId}, 'verified', true, now(),
      ST_SetSRID(ST_MakePoint(${ORIGIN.lng + metresAway * DEG_PER_M}, ${ORIGIN.lat}), 4326)::geography,
      0
    )
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
      now() - interval '5 minutes', now() + interval '55 minutes', 'confirmed',
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
  readonly assignedUserId?: string;
  readonly arrivedMinutesAgo?: number;
  readonly withOutboundCharge?: boolean;
  readonly distanceM?: number;
}

/** A valet job in a given state, written directly — the worker has no commands. */
async function seedJob(opts: SeedJobOptions): Promise<string> {
  const bookingId = await seedBooking();
  const distanceM = opts.distanceM ?? 3200;

  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO valet_jobs (
      booking_id, driver_user_id, assigned_user_id, status,
      pickup_location, pickup_address, offer_radius_m, offer_round,
      distance_m, fee_paise, commission_rate, txn_id, arrived_at
    )
    VALUES (
      ${bookingId}, ${driverId}, ${opts.assignedUserId ?? null}, ${opts.status},
      ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
      'Forum Mall, Koramangala', 5000, ${opts.offerRound ?? 0},
      ${opts.withOutboundCharge === true ? distanceM : null},
      ${opts.withOutboundCharge === true ? 9000 : null},
      ${VALET_COMMISSION_RATE.toFixed(3)},
      ${opts.withOutboundCharge === true ? pg.sql`uuidv7()` : null},
      ${opts.arrivedMinutesAgo === undefined ? null : pg.sql`now() - make_interval(mins => ${opts.arrivedMinutesAgo})`}
    )
    RETURNING id
  `;
  if (row === undefined) throw new Error('failed to seed valet job');

  // The outbound leg as `accept-job.command.ts` posts it: 9324 / 7200 / 1800 / 324.
  if (opts.withOutboundCharge === true && opts.assignedUserId !== undefined) {
    const [job] = await pg.sql<{ txn_id: string }[]>`
      SELECT txn_id FROM valet_jobs WHERE id = ${row.id}
    `;
    for (const [account, direction, amount, counterparty] of [
      ['driver_receivable', 'debit', 9324, null],
      ['owner_payable', 'credit', 7200, opts.assignedUserId],
      ['platform_revenue', 'credit', 1800, null],
      ['gst_payable', 'credit', 324, null],
    ] as const) {
      await pg.sql`
        INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, description, booking_id, counterparty_user_id)
        VALUES (${job!.txn_id}, ${account}, ${direction}, ${amount}, 'valet outbound leg', ${bookingId}, ${counterparty})
      `;
    }
  }

  return row.id;
}

const statusOf = async (jobId: string) => {
  const [row] = await pg.sql<
    { status: string; offer_round: number; cancellation_reason: string | null }[]
  >`
    SELECT status, offer_round, cancellation_reason FROM valet_jobs WHERE id = ${jobId}
  `;
  return row!;
};

const offersFor = async (jobId: string) => {
  const [row] = await pg.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM valet_job_offers WHERE job_id = ${jobId}
  `;
  return row!.n;
};

const outboxOf = async (type: string) => {
  const [row] = await pg.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM outbox_messages WHERE type = ${type}
  `;
  return row!.n;
};

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    // Neither valet job touches the cache.
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
    TRUNCATE valet_job_offers, valet_jobs, ledger_entries, outbox_messages,
             bookings, booking_slots, valet_profiles
    RESTART IDENTITY CASCADE
  `;
});

describe('valet.accept-timeout — widening the search', () => {
  it('re-offers at 8 km on round 1 and schedules the next timeout', async () => {
    await seedValet(6500); // outside 5 km, inside 8 km
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });

    const job = await statusOf(jobId);
    expect(job.status).toBe('offered');
    expect(job.offer_round).toBe(1);
    expect(await offersFor(jobId)).toBe(1);
    expect(await outboxOf('valet.accept-timeout')).toBe(1);
    expect(await outboxOf('notification.dispatch')).toBe(1);
  });

  it('does not re-offer to a valet who already saw this job', async () => {
    const valetId = await seedValet(2000);
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });
    await pg.sql`
      INSERT INTO valet_job_offers (job_id, valet_user_id, distance_m, outcome)
      VALUES (${jobId}, ${valetId}, 2000, 'pending')
    `;

    await acceptTimeout(deps, { jobId, round: 0 });

    // Still the one original offer — the anti-join excluded them.
    expect(await offersFor(jobId)).toBe(1);
  });

  it('cancels with no_valet_available after the last radius, and charges nothing', async () => {
    const jobId = await seedJob({ status: 'offered', offerRound: 2 });

    await acceptTimeout(deps, { jobId, round: 2 });

    const job = await statusOf(jobId);
    expect(job.status).toBe('cancelled');
    expect(job.cancellation_reason).toBe('no_valet_available');

    const [ledger] = await pg.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ledger_entries`;
    expect(ledger!.n).toBe(0);
    expect(await outboxOf('notification.dispatch')).toBe(1);
  });

  /** pg-boss delivery is at-least-once (R-ASYNC-03). */
  it('is a no-op on redelivery of the same round', async () => {
    await seedValet(6500);
    const jobId = await seedJob({ status: 'offered', offerRound: 0 });

    await acceptTimeout(deps, { jobId, round: 0 });
    await acceptTimeout(deps, { jobId, round: 0 });

    // The second delivery saw offer_round = 1 and stopped.
    expect((await statusOf(jobId)).offer_round).toBe(1);
    expect(await offersFor(jobId)).toBe(1);
    expect(await outboxOf('valet.accept-timeout')).toBe(1);
  });

  it('is a no-op for a stale round while a later one is live', async () => {
    await seedValet(2000);
    const jobId = await seedJob({ status: 'offered', offerRound: 2 });

    await acceptTimeout(deps, { jobId, round: 0 });

    expect((await statusOf(jobId)).offer_round).toBe(2);
    expect((await statusOf(jobId)).status).toBe('offered');
  });

  it.each(['accepted', 'cancelled', 'completed'])(
    'is a no-op on a job that is already %s',
    async (status) => {
      // `accepted` and `completed` both require an assignee —
      // `valet_jobs_assignee_presence_check` refuses the row otherwise, which is
      // the constraint working. Only `cancelled` is deliberately unconstrained.
      const valetId = status === 'cancelled' ? undefined : await seedValet(1000);
      const jobId = await seedJob({
        status,
        offerRound: 0,
        ...(valetId === undefined ? {} : { assignedUserId: valetId }),
      });

      await acceptTimeout(deps, { jobId, round: 0 });

      expect((await statusOf(jobId)).status).toBe(status);
      expect(await outboxOf('valet.accept-timeout')).toBe(0);
    },
  );

  it('rejects a malformed payload loudly rather than acting on undefined', async () => {
    await expect(acceptTimeout(deps, { jobId: 'not-a-uuid', round: 0 })).rejects.toThrow(
      /Malformed valet job payload/,
    );
    await expect(acceptTimeout(deps, {})).rejects.toThrow(/Malformed valet job payload/);
  });
});

describe('valet.no-show — the call-out, not the leg', () => {
  it('charges the call-out and refunds the difference', async () => {
    const valetId = await seedValet(1000);
    const jobId = await seedJob({
      status: 'arrived',
      assignedUserId: valetId,
      arrivedMinutesAgo: 11,
      withOutboundCharge: true,
    });

    await noShow(deps, { jobId });

    expect((await statusOf(jobId)).status).toBe('no_show');

    // §11.8: the adjustment posting is 3200 / 800 / 144 debit, 4144 credit.
    const entries = await pg.sql<{ account: string; direction: string; amount_paise: string }[]>`
      SELECT account, direction, amount_paise FROM ledger_entries
      WHERE description = 'valet no-show call-out adjustment' ORDER BY account
    `;
    expect(entries).toEqual([
      { account: 'gst_payable', direction: 'debit', amount_paise: '144' },
      { account: 'owner_payable', direction: 'debit', amount_paise: '3200' },
      { account: 'platform_revenue', direction: 'debit', amount_paise: '800' },
      { account: 'refunds_payable', direction: 'credit', amount_paise: '4144' },
    ]);

    // The driver nets to the call-out fee across both postings.
    const [net] = await pg.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0) AS net
      FROM ledger_entries WHERE account = 'driver_receivable'
    `;
    const [refunded] = await pg.sql<{ total: string }[]>`
      SELECT coalesce(sum(amount_paise), 0) AS total FROM ledger_entries
      WHERE account = 'refunds_payable' AND direction = 'credit'
    `;
    expect(Number(net!.net) - Number(refunded!.total)).toBe(5180);

    expect(await outboxOf('payment.issue-refund')).toBe(1);
    expect(await outboxOf('notification.dispatch')).toBe(1);
  });

  it('debits the clawback against the valet, not against nobody', async () => {
    const valetId = await seedValet(1000);
    const jobId = await seedJob({
      status: 'arrived',
      assignedUserId: valetId,
      arrivedMinutesAgo: 11,
      withOutboundCharge: true,
    });

    await noShow(deps, { jobId });

    const [row] = await pg.sql<{ counterparty_user_id: string | null }[]>`
      SELECT counterparty_user_id FROM ledger_entries
      WHERE account = 'owner_payable' AND direction = 'debit'
    `;
    expect(row!.counterparty_user_id).toBe(valetId);

    // And the valet's net balance is the call-out share, not the full leg.
    const [balance] = await pg.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0) AS net
      FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${valetId}
    `;
    expect(Number(balance!.net)).toBe(4000);
  });

  it('is a no-op before the grace period lapses', async () => {
    const valetId = await seedValet(1000);
    const jobId = await seedJob({
      status: 'arrived',
      assignedUserId: valetId,
      arrivedMinutesAgo: 9,
      withOutboundCharge: true,
    });

    await noShow(deps, { jobId });

    expect((await statusOf(jobId)).status).toBe('arrived');
    const [adj] = await pg.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE description = 'valet no-show call-out adjustment'
    `;
    expect(adj!.n).toBe(0);
    expect(NO_SHOW_GRACE_MS).toBe(10 * 60 * 1000);
  });

  it('produces exactly one adjustment when delivered twice', async () => {
    const valetId = await seedValet(1000);
    const jobId = await seedJob({
      status: 'arrived',
      assignedUserId: valetId,
      arrivedMinutesAgo: 11,
      withOutboundCharge: true,
    });

    await noShow(deps, { jobId });
    await noShow(deps, { jobId });

    const [txns] = await pg.sql<{ n: number }[]>`
      SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries
      WHERE description = 'valet no-show call-out adjustment'
    `;
    expect(txns!.n).toBe(1);
    expect(await outboxOf('payment.issue-refund')).toBe(1);
  });

  it.each(['parking', 'parked', 'cancelled', 'completed'])(
    'is a no-op once the job has moved to %s',
    async (status) => {
      const valetId = await seedValet(1000);
      const jobId = await seedJob({
        status,
        assignedUserId: valetId,
        arrivedMinutesAgo: 30,
        withOutboundCharge: true,
      });

      await noShow(deps, { jobId });

      expect((await statusOf(jobId)).status).toBe(status);
      expect(await outboxOf('payment.issue-refund')).toBe(0);
    },
  );

  it('rejects a malformed payload loudly', async () => {
    await expect(noShow(deps, { jobId: 42 })).rejects.toThrow(/Malformed valet job payload/);
  });

  /**
   * The table-wide invariant, on the rows this job wrote. Feeds the same
   * guarantee `ledger-balance.spec.ts` asserts across every posting.
   */
  it('leaves every txn_id balanced', async () => {
    const valetId = await seedValet(1000);
    const jobId = await seedJob({
      status: 'arrived',
      assignedUserId: valetId,
      arrivedMinutesAgo: 11,
      withOutboundCharge: true,
    });

    await noShow(deps, { jobId });

    const [unbalanced] = await pg.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT txn_id FROM ledger_entries GROUP BY txn_id
        HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
            <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
      ) t
    `;
    expect(unbalanced!.n).toBe(0);
  });
});
