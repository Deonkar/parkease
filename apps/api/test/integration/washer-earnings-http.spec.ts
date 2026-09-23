import { uuidv7 } from '@parkease/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * The earnings endpoint's period filter and per-job lines, through the real
 * Fastify pipeline — same reasoning as `carwash-http.spec.ts`: a command call
 * cannot see an interceptor, a status code, a response envelope or an error
 * code, and half of what this file asserts is exactly one of those.
 */

let h: Harness;
let http: HttpApp;
let spaceId: string;

const SPACE = { lat: 12.9352, lng: 77.6245 };

const asUser = (id: string, roles: string[]) => {
  actingAs.user = { id, roles, activeRole: roles[0] ?? null };
};

const key = () => ({ 'idempotency-key': uuidv7() });

interface ErrorBody {
  error: { code: string; message: string; traceId: string };
}
interface DataBody<T> {
  data: T;
}

const errorOf = (body: unknown): ErrorBody['error'] => (body as ErrorBody).error;
const dataOf = <T>(body: unknown): T => (body as DataBody<T>).data;

/** A verified, online, onboarded partner standing ~500 m from the space. */
async function seedWasher(): Promise<string> {
  const userId = await seedUser(h, 'washer');
  const degPerM = 1 / (111_320 * Math.cos((SPACE.lat * Math.PI) / 180));
  const lng = SPACE.lng + 500 * degPerM;

  await h.sql`
    INSERT INTO washer_profiles (
      user_id, partner_type, verification_status, is_online, last_seen_at,
      current_location, rating_count
    )
    VALUES (
      ${userId}, 'gig', 'verified', true, now(),
      ST_SetSRID(ST_MakePoint(${lng}, ${SPACE.lat}), 4326)::geography,
      0
    )
  `;

  await h.sql`
    INSERT INTO wash_services (washer_user_id, service_name, vehicle_type, price_paise, duration_minutes)
    VALUES
      (${userId}, 'premium_wash', 'car', 39900, 40),
      (${userId}, 'premium_wash', 'two_wheeler', 14900, 40),
      (${userId}, 'quick_wipe', 'car', 9900, 10)
  `;

  await h.sql`
    INSERT INTO linked_accounts (user_id, razorpay_account_id, kyc_status)
    VALUES (${userId}, ${`acc_${userId.slice(0, 12)}`}, 'activated')
  `;

  return userId;
}

/** A booking in the given status, which is the whole precondition (§13.5). */
async function seedBookingWithStatus(status: string, slotIndex = 1): Promise<string> {
  const bookingId = await seedBooking(h, {
    spaceId,
    vehicleType: 'car',
    slotIndex,
    slotStatus: 'confirmed',
  });
  await h.sql`UPDATE bookings SET status = ${status} WHERE id = ${bookingId}`;
  return bookingId;
}

const requestWash = (bookingId: string, serviceName = 'premium_wash', vehicleType = 'car') => {
  asUser(h.driverId, ['driver']);
  return http.request({
    method: 'POST',
    url: '/api/v1/driver/carwash/requests',
    headers: key(),
    payload: { bookingId, serviceName, vehicleType },
  });
};

/** Requests a wash against an `active` booking and returns the job id. */
async function openJob(slotIndex = 1): Promise<string> {
  const bookingId = await seedBookingWithStatus('active', slotIndex);
  const res = await requestWash(bookingId);
  expect(res.status).toBe(201);
  return dataOf<{ id: string }>(res.body).id;
}

const accept = (jobId: string, washerId: string) => {
  asUser(washerId, ['washer']);
  return http.request({
    method: 'POST',
    url: `/api/v1/washer/jobs/${jobId}/accept`,
    headers: key(),
    payload: {},
  });
};

const advance = (jobId: string, washerId: string, event: string) => {
  asUser(washerId, ['washer']);
  return http.request({
    method: 'POST',
    url: `/api/v1/washer/jobs/${jobId}/status`,
    headers: key(),
    payload: { event },
  });
};

const attachPhoto = (jobId: string, washerId: string, slot: 'before' | 'after') => {
  asUser(washerId, ['washer']);
  return http.request({
    method: 'POST',
    url: `/api/v1/washer/jobs/${jobId}/${slot}-photo`,
    headers: key(),
    payload: { photoId: `wash/${slot}/abc123` },
  });
};

/** Walks a job through the full happy path so it lands `completed`, priced 39900. */
async function completeAJob(washerId: string, slotIndex = 1): Promise<string> {
  const jobId = await openJob(slotIndex);
  expect((await accept(jobId, washerId)).status).toBe(200);
  expect((await advance(jobId, washerId, 'en_route')).status).toBe(200);
  expect((await attachPhoto(jobId, washerId, 'before')).status).toBe(200);
  expect((await advance(jobId, washerId, 'start_washing')).status).toBe(200);
  expect((await attachPhoto(jobId, washerId, 'after')).status).toBe(200);
  const done = await advance(jobId, washerId, 'complete');
  expect(done.status).toBe(200);

  return jobId;
}

/**
 * Moves a completed job into the past for the *lines* query, which bounds on
 * `wash_jobs.completed_at`. `ledger_entries` is append-only (ADR-008) — no
 * UPDATE reaches it, so this deliberately leaves `occurred_at` where it is.
 * The summary side of the period bound is exercised with `postWashAt`, which
 * writes ledger rows already dated in the past.
 */
async function backdateCompletion(jobId: string, daysAgo: number): Promise<void> {
  await h.sql`
    UPDATE wash_jobs SET completed_at = now() - make_interval(days => ${daysAgo})
    WHERE id = ${jobId}
  `;
}

/**
 * Posts one wash's accept credit, or its cancellation reversal, straight into
 * the ledger at an explicit instant `daysAgo` days before now.
 *
 * `ledger_entries` is append-only (ADR-008) — a trigger refuses UPDATE — so a
 * posting that has to sit before the period began must be *born* there; it
 * cannot be backdated afterwards. Each call is one balanced transaction of its
 * own `txn_id`, the same shape `accept-wash` and `cancel-wash` post: 39900 from
 * the driver, 31920 to this partner, 7980 to the platform — and a reversal is
 * that, flipped, under a NEW `txn_id`, exactly as `cancel-wash` does it.
 */
async function postWashAt(
  washerId: string,
  kind: 'accept' | 'reversal',
  daysAgo: number,
): Promise<void> {
  const txnId = uuidv7();
  const flip = (direction: 'debit' | 'credit') =>
    kind === 'accept' ? direction : direction === 'debit' ? 'credit' : 'debit';
  const description = kind === 'accept' ? 'car wash service' : 'car wash cancellation reversal';

  await h.sql`
    INSERT INTO ledger_entries
      (txn_id, account, direction, amount_paise, counterparty_user_id, description, occurred_at)
    SELECT ${txnId}::uuid, v.account, v.direction, v.amount_paise, v.counterparty_user_id,
           ${description}, now() - make_interval(days => ${daysAgo})
    FROM (VALUES
      ('driver_receivable', ${flip('debit')}, 39900, NULL::uuid),
      ('owner_payable', ${flip('credit')}, 31920, ${washerId}::uuid),
      ('platform_revenue', ${flip('credit')}, 7980, NULL::uuid)
    ) AS v(account, direction, amount_paise, counterparty_user_id)
  `;
}

interface Summary {
  grossPaise: number;
  reversedPaise: number;
  netPaise: number;
  jobsCompleted: number;
}

const earnings = (washerId: string, query = '') => {
  asUser(washerId, ['washer']);
  return http.request({ method: 'GET', url: `/api/v1/washer/earnings${query}` });
};

beforeAll(async () => {
  h = await startHarness();
  http = await startHttpApp(h);
  spaceId = await seedSpace(h, {
    lat: SPACE.lat,
    lng: SPACE.lng,
    pricing: HOURLY_ONLY,
    schedule: OPEN_ALWAYS,
    carSlots: 4,
  });
}, 180_000);

afterAll(async () => {
  await stopHttpApp(http);
  await stopHarness(h);
});

beforeEach(async () => {
  await h.sql`
    TRUNCATE bookings, booking_slots, wash_jobs, wash_job_offers, wash_services,
             washer_profiles, linked_accounts, payments, refunds,
             ledger_entries, outbox_messages, idempotency_keys
    RESTART IDENTITY CASCADE
  `;
  actingAs.user = null;
});

describe('GET /washer/earnings — period filter and per-job lines', () => {
  it('bounds the summary by posting time: a credit posted before the week is in `all`, not `week`', async () => {
    // Ten days ago is before the start of any IST week, whatever day this runs.
    const washerId = await seedWasher();
    await postWashAt(washerId, 'accept', 10);
    await completeAJob(washerId);

    const week = await earnings(washerId, '?period=week');
    expect(week.status).toBe(200);
    expect(dataOf<{ summary: Summary }>(week.body).summary).toEqual({
      grossPaise: 31920,
      reversedPaise: 0,
      netPaise: 31920,
      jobsCompleted: 1,
    });

    // The control: the old credit is really there, and `all` does see it.
    const all = await earnings(washerId, '?period=all');
    expect(all.status).toBe(200);
    expect(dataOf<{ summary: Summary }>(all.body).summary).toMatchObject({
      grossPaise: 63840,
      netPaise: 63840,
    });
  });

  /**
   * Accepted Sunday 23:55 IST, cancelled Monday 00:05. The credit posted last
   * week; the reversal posts this week under a new `txn_id`. This week's
   * movement on `owner_payable` is therefore one debit and no credit, and a
   * period's net is movement — so it is negative, and the endpoint must say so
   * rather than fail its own response parse on the default period.
   */
  it('reports a negative net for a period holding a reversal whose credit posted earlier', async () => {
    const washerId = await seedWasher();
    await postWashAt(washerId, 'accept', 10);
    await postWashAt(washerId, 'reversal', 0);

    for (const query of ['?period=week', '']) {
      const res = await earnings(washerId, query);
      expect(res.status).toBe(200);
      expect(dataOf<{ period: string; summary: Summary; lines: unknown[] }>(res.body)).toEqual({
        period: 'week',
        summary: { grossPaise: 0, reversedPaise: 31920, netPaise: -31920, jobsCompleted: 0 },
        lines: [],
      });
    }

    // Over the partner's whole history the two cancel out, as they must.
    const all = await earnings(washerId, '?period=all');
    expect(dataOf<{ summary: Summary }>(all.body).summary.netPaise).toBe(0);
  });

  it('reads the fee from platform_revenue rather than subtracting it', async () => {
    // A wash priced 39900 whose posting credits 7980 to platform_revenue and
    // 31920 to owner_payable — the same fixture carwash-http.spec.ts's ledger
    // tests rely on for the same numbers.
    const washerId = await seedWasher();
    await completeAJob(washerId);

    asUser(washerId, ['washer']);
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/earnings?period=all' });
    expect(res.status).toBe(200);

    const lines = dataOf<{ lines: { grossPaise: number; feePaise: number; netPaise: number }[] }>(
      res.body,
    ).lines;
    expect(lines[0]).toMatchObject({
      grossPaise: 39900,
      feePaise: 7980,
      netPaise: 31920,
    });
  });

  it('lists a job completed today and excludes one completed before the period began', async () => {
    const washerId = await seedWasher();
    const lastWeeksJobId = await completeAJob(washerId);
    await backdateCompletion(lastWeeksJobId, 8);
    // The positive control: without it, a `today` that always returned an
    // empty list would pass the exclusion below.
    const todaysJobId = await completeAJob(washerId, 2);

    const res = await earnings(washerId, '?period=today');
    expect(res.status).toBe(200);

    const view = dataOf<{ summary: Summary; lines: { jobId: string }[] }>(res.body);
    expect(view.lines.map((l) => l.jobId)).toEqual([todaysJobId]);
    expect(view.summary.jobsCompleted).toBe(1);
  });

  it('refuses a period it does not know, as a 400 with the error envelope', async () => {
    const washerId = await seedWasher();
    asUser(washerId, ['washer']);

    const res = await http.request({
      method: 'GET',
      url: '/api/v1/washer/earnings?period=fortnight',
    });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBeDefined();
  });

  it('answers 401 without a token and 403 for a driver', async () => {
    actingAs.user = null;
    const noToken = await http.request({ method: 'GET', url: '/api/v1/washer/earnings' });
    expect(noToken.status).toBe(401);

    asUser(h.driverId, ['driver']);
    const asDriver = await http.request({ method: 'GET', url: '/api/v1/washer/earnings' });
    expect(asDriver.status).toBe(403);
  });
});
