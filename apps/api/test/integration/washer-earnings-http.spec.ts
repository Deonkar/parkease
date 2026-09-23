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
async function openJob(): Promise<string> {
  const bookingId = await seedBookingWithStatus('active');
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
async function completeAJob(washerId: string): Promise<string> {
  const jobId = await openJob();
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
 * UPDATE reaches it, so this deliberately leaves `occurred_at` where it is;
 * the summary side of the period bound is exercised by the two tests above,
 * not by this one.
 */
async function backdateCompletion(jobId: string, daysAgo: number): Promise<void> {
  await h.sql`
    UPDATE wash_jobs SET completed_at = now() - make_interval(days => ${daysAgo})
    WHERE id = ${jobId}
  `;
}

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
  it('returns the same net as a direct owner_payable balance for this counterparty', async () => {
    const washerId = await seedWasher();
    await completeAJob(washerId);

    asUser(washerId, ['washer']);
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/earnings?period=week' });
    expect(res.status).toBe(200);

    const [row] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0) AS net
      FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${washerId}
        AND occurred_at >= date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
    `;

    expect(dataOf<{ summary: { netPaise: number } }>(res.body).summary.netPaise).toBe(
      Number(row?.net),
    );
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

  it('excludes a job completed before the period began', async () => {
    const washerId = await seedWasher();
    const lastWeeksJobId = await completeAJob(washerId);
    await backdateCompletion(lastWeeksJobId, 8);

    asUser(washerId, ['washer']);
    const res = await http.request({
      method: 'GET',
      url: '/api/v1/washer/earnings?period=today',
    });
    expect(res.status).toBe(200);

    const lines = dataOf<{ lines: { jobId: string }[] }>(res.body).lines;
    expect(lines.map((l) => l.jobId)).not.toContain(lastWeeksJobId);
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
