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
 * The car wash surface, through the real Fastify pipeline.
 *
 * Driven as HTTP rather than by calling commands, because a command call cannot
 * see an interceptor, a status code, a response envelope or an error code — and
 * every assertion below is about one of those.
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

interface SeedWasherOptions {
  readonly online?: boolean;
  readonly verified?: boolean;
  readonly onboarded?: boolean;
  readonly metresAway?: number;
}

/** A verified, online, onboarded partner standing ~500 m from the space. */
async function seedWasher(opts: SeedWasherOptions = {}): Promise<string> {
  const userId = await seedUser(h, 'washer');
  const degPerM = 1 / (111_320 * Math.cos((SPACE.lat * Math.PI) / 180));
  const lng = SPACE.lng + (opts.metresAway ?? 500) * degPerM;

  await h.sql`
    INSERT INTO washer_profiles (
      user_id, partner_type, verification_status, is_online, last_seen_at,
      current_location, rating_count
    )
    VALUES (
      ${userId}, 'gig',
      ${opts.verified === false ? 'pending' : 'verified'},
      ${opts.online !== false},
      now(),
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

  /**
   * ADR-013. Accept refuses a partner with no activated Linked Account, so
   * every fixture that means to accept has to have one — which is itself the
   * design under test, not harness noise.
   */
  if (opts.onboarded !== false) {
    await h.sql`
      INSERT INTO linked_accounts (user_id, razorpay_account_id, kyc_status)
      VALUES (${userId}, ${`acc_${userId.slice(0, 12)}`}, 'activated')
    `;
  }

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

beforeAll(async () => {
  h = await startHarness();
  http = await startHttpApp(h);
  spaceId = await seedSpace(h, {
    lat: SPACE.lat,
    lng: SPACE.lng,
    pricing: HOURLY_ONLY,
    schedule: OPEN_ALWAYS,
    slots: { car: 4 },
  });
}, 180_000);

afterAll(async () => {
  await stopHttpApp(http);
  await stopHarness(h);
});

beforeEach(async () => {
  /**
   * Bookings go too, not just the wash rows. `booking_slots` carries an
   * `EXCLUDE USING gist` overlap constraint and every test seeds the same slot
   * window, so leaving the previous test's slot in place makes the *next* test
   * fail on a constraint that is working perfectly.
   */
  await h.sql`
    TRUNCATE bookings, booking_slots, wash_jobs, wash_job_offers, wash_services,
             washer_profiles, linked_accounts, payments, refunds,
             ledger_entries, outbox_messages, idempotency_keys
    RESTART IDENTITY CASCADE
  `;
  actingAs.user = null;
});

describe('POST /driver/carwash/requests — the precondition', () => {
  /**
   * §13. The v1 bug this task exists to not repeat: a wash offered at
   * `confirmed`, before the car has arrived, is a charge that must be refunded
   * and a partner dispatched to an empty bay.
   */
  it.each(['confirmed', 'pending_payment', 'completed', 'cancelled'])(
    'refuses a wash on a %s booking',
    async (status) => {
      await seedWasher();
      const bookingId = await seedBookingWithStatus(status);

      const res = await requestWash(bookingId);

      expect(res.status).toBe(400);
      expect(errorOf(res.body).code).toBe('BOOKING_NOT_WASH_ELIGIBLE');
      expect(errorOf(res.body).message).toBe(
        'Your car needs to be parked before we can arrange a wash.',
      );
    },
  );

  it('accepts a wash on an active booking', async () => {
    await seedWasher();
    const bookingId = await seedBookingWithStatus('active');

    const res = await requestWash(bookingId);

    expect(res.status).toBe(201);
    const job = dataOf<{ status: string; offeredTo: number }>(res.body);
    expect(job.status).toBe('offered');
    expect(job.offeredTo).toBe(1);
  });

  it('still creates the job when nobody is nearby, so the ladder can widen', async () => {
    const bookingId = await seedBookingWithStatus('active');

    const res = await requestWash(bookingId);

    expect(res.status).toBe(201);
    const job = dataOf<{ status: string; offeredTo: number }>(res.body);
    expect(job.status).toBe('requested');
    expect(job.offeredTo).toBe(0);
  });

  it('refuses a second live wash for the same service on the same booking', async () => {
    await seedWasher();
    const bookingId = await seedBookingWithStatus('active');

    await requestWash(bookingId);
    const second = await requestWash(bookingId);

    expect(second.status).toBe(409);
    expect(errorOf(second.body).code).toBe('WASH_ALREADY_REQUESTED');
  });

  /**
   * Scoped per service, not per booking: a driver who wants an interior clean
   * and an exterior wash is asking for two jobs two partners could take.
   */
  it('allows a different service on the same booking', async () => {
    await seedWasher();
    const bookingId = await seedBookingWithStatus('active');

    await requestWash(bookingId, 'premium_wash');
    const second = await requestWash(bookingId, 'quick_wipe');

    expect(second.status).toBe(201);
  });

  it('answers 404 for a booking that belongs to somebody else', async () => {
    const otherDriver = await seedUser(h, 'driver');
    const bookingId = await seedBookingWithStatus('active');

    asUser(otherDriver, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/carwash/requests',
      headers: key(),
      payload: { bookingId, serviceName: 'premium_wash', vehicleType: 'car' },
    });

    expect(res.status).toBe(404);
  });

  it('refuses a service outside the v1 catalogue', async () => {
    const bookingId = await seedBookingWithStatus('active');

    const res = await requestWash(bookingId, 'ceramic_coating');

    expect(res.status).toBe(400);
  });
});

describe('POST /washer/jobs/:id/accept — first accept wins', () => {
  it('lets exactly one of three partners win', async () => {
    const washers = [await seedWasher(), await seedWasher(), await seedWasher()];
    const jobId = await openJob();

    const offers = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM wash_job_offers WHERE job_id = ${jobId}
    `;
    expect(offers[0]?.n).toBe(3);

    /**
     * Sequential, not `Promise.all`. `actingAs` is module-level state shared by
     * every request through this harness, so three concurrent accepts would all
     * authenticate as whichever partner happened to write it last — and the
     * test would pass for entirely the wrong reason. The race being asserted
     * lives in the database, not in the client: each request still meets a row
     * the previous one has already moved out of `offered`.
     */
    const statuses: number[] = [];
    const bodies: unknown[] = [];
    for (const washerId of washers) {
      const res = await accept(jobId, washerId);
      statuses.push(res.status);
      bodies.push(res.body);
    }

    expect([...statuses].sort()).toEqual([200, 409, 409]);

    for (const [i, status] of statuses.entries()) {
      if (status !== 409) continue;
      const err = errorOf(bodies[i]);
      expect(err.code).toBe('WASH_JOB_TAKEN');
      expect(err.message).toBe('This job was taken by another partner. More jobs coming!');
    }

    const [row] = await h.sql<{ status: string; washer_user_id: string | null }[]>`
      SELECT status, washer_user_id FROM wash_jobs WHERE id = ${jobId}
    `;
    expect(row?.status).toBe('accepted');
    expect(row?.washer_user_id).not.toBeNull();

    const outcomes = await h.sql<{ outcome: string; n: number }[]>`
      SELECT outcome, count(*)::int AS n FROM wash_job_offers
      WHERE job_id = ${jobId} GROUP BY outcome ORDER BY outcome
    `;
    expect(outcomes).toEqual([
      { outcome: 'lost', n: 2 },
      { outcome: 'won', n: 1 },
    ]);
  });

  it('freezes the price and the commission rate on the row', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();

    await accept(jobId, washerId);

    const [row] = await h.sql<{ price_paise: string; commission_rate: string }[]>`
      SELECT price_paise, commission_rate FROM wash_jobs WHERE id = ${jobId}
    `;
    expect(Number(row?.price_paise)).toBe(39900);
    expect(Number(row?.commission_rate)).toBe(0.2);
  });

  /**
   * ADR-013. A partner we cannot route money to must not take the job at all —
   * the alternative is a driver with somebody on the way and no way to pay them.
   */
  it('refuses a partner with no activated linked account', async () => {
    const washerId = await seedWasher({ onboarded: false });
    const jobId = await openJob();

    const res = await accept(jobId, washerId);

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('WASHER_NOT_ONBOARDED');
  });

  /**
   * A 409 would confirm the job exists, which is a job-id oracle for anyone
   * holding a washer token (R-SEC-04).
   */
  it('answers 404 to a partner who was never offered the job', async () => {
    await seedWasher();
    const stranger = await seedWasher({ metresAway: 50_000 });
    const jobId = await openJob();

    const res = await accept(jobId, stranger);

    expect(res.status).toBe(404);
  });

  it('replays a retried accept under the same Idempotency-Key', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    const headers = key();

    asUser(washerId, ['washer']);
    const first = await http.request({
      method: 'POST',
      url: `/api/v1/washer/jobs/${jobId}/accept`,
      headers,
      payload: {},
    });
    const replay = await http.request({
      method: 'POST',
      url: `/api/v1/washer/jobs/${jobId}/accept`,
      headers,
      payload: {},
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    // The assignment happened once, not twice.
    const entries = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${washerId}
    `;
    expect(entries[0]?.n).toBe(1);
  });
});

describe('the ledger', () => {
  it('posts the four balanced entries from §13.7', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();

    await accept(jobId, washerId);

    const entries = await h.sql<
      {
        account: string;
        direction: string;
        amount_paise: string;
        counterparty_user_id: string | null;
      }[]
    >`
      SELECT account, direction, amount_paise, counterparty_user_id
      FROM ledger_entries
      WHERE txn_id = (SELECT txn_id FROM wash_jobs WHERE id = ${jobId})
      ORDER BY account
    `;

    expect(entries).toHaveLength(4);
    expect(entries.map((e) => [e.account, e.direction, Number(e.amount_paise)])).toEqual([
      ['driver_receivable', 'debit', 41336],
      ['gst_payable', 'credit', 1436],
      ['owner_payable', 'credit', 31920],
      ['platform_revenue', 'credit', 7980],
    ]);

    // The partner is named on owner_payable and on nothing else.
    for (const entry of entries) {
      expect(entry.counterparty_user_id).toBe(entry.account === 'owner_payable' ? washerId : null);
    }
  });

  it('balances', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    const [row] = await h.sql<{ unbalanced: number }[]>`
      SELECT count(*)::int AS unbalanced FROM (
        SELECT txn_id FROM ledger_entries GROUP BY txn_id
        HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
            <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
      ) t
    `;
    expect(row?.unbalanced).toBe(0);
  });

  /**
   * R-MONEY-05. The endpoint and a direct balance query must not be able to
   * disagree, which is why this compares them rather than asserting a literal.
   * `?period=all` because the balance below is lifetime: the endpoint defaults
   * to `week`, and the two would agree only while every fixture row is current.
   */
  it('reports earnings that match a direct owner_payable balance', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    asUser(washerId, ['washer']);
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/earnings?period=all' });

    const [balance] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0) AS net
      FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${washerId}
    `;

    expect(res.status).toBe(200);
    expect(dataOf<{ summary: { netPaise: number } }>(res.body).summary.netPaise).toBe(
      Number(balance?.net),
    );
  });
});

describe('the photo gates', () => {
  it('refuses start_washing without a before photo', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);
    await advance(jobId, washerId, 'en_route');

    const res = await advance(jobId, washerId, 'start_washing');

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('BEFORE_PHOTO_REQUIRED');
  });

  it('refuses complete without an after photo', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);
    await advance(jobId, washerId, 'en_route');
    await attachPhoto(jobId, washerId, 'before');
    await advance(jobId, washerId, 'start_washing');

    const res = await advance(jobId, washerId, 'complete');

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('AFTER_PHOTO_REQUIRED');
  });

  it('walks the full happy path once both photos are attached', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();

    await accept(jobId, washerId);
    expect((await advance(jobId, washerId, 'en_route')).status).toBe(200);
    expect((await attachPhoto(jobId, washerId, 'before')).status).toBe(200);
    expect((await advance(jobId, washerId, 'start_washing')).status).toBe(200);
    expect((await attachPhoto(jobId, washerId, 'after')).status).toBe(200);

    const done = await advance(jobId, washerId, 'complete');
    expect(done.status).toBe(200);
    expect(dataOf<{ status: string }>(done.body).status).toBe('completed');
  });

  it('refuses a photo id that is a URL', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    asUser(washerId, ['washer']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/washer/jobs/${jobId}/before-photo`,
      headers: key(),
      payload: { photoId: 'https://example.com/anything.jpg' },
    });

    expect(res.status).toBe(400);
  });
});

describe('cancellation', () => {
  const cancel = (jobId: string) => {
    asUser(h.driverId, ['driver']);
    return http.request({
      method: 'POST',
      url: `/api/v1/driver/carwash/requests/${jobId}/cancel`,
      headers: key(),
      payload: { reason: 'changed my mind' },
    });
  };

  it('posts nothing when cancelled before anybody accepted', async () => {
    await seedWasher();
    const jobId = await openJob();

    const res = await cancel(jobId);

    expect(res.status).toBe(200);
    const entries = await h.sql`SELECT 1 FROM ledger_entries`;
    expect(entries).toHaveLength(0);
  });

  it('posts a balanced reversal when cancelled after accept', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    expect((await cancel(jobId)).status).toBe(200);

    const [balance] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0) AS net
      FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${washerId}
    `;
    // Credited at accept, debited back on cancel: the partner is owed nothing.
    expect(Number(balance?.net)).toBe(0);
  });

  /**
   * §13.9. The partner has travelled with their equipment and started, so the
   * machine has no cancel edge from `washing` at all.
   */
  it('refuses a cancellation once washing has begun', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);
    await advance(jobId, washerId, 'en_route');
    await attachPhoto(jobId, washerId, 'before');
    await advance(jobId, washerId, 'start_washing');

    const res = await cancel(jobId);

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('ILLEGAL_CARWASH_TRANSITION');
  });

  it('answers 404 for somebody else s wash', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    const stranger = await seedUser(h, 'driver');
    asUser(stranger, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/driver/carwash/requests/${jobId}/cancel`,
      headers: key(),
      payload: {},
    });

    expect(res.status).toBe(404);
  });
});

describe('authorisation', () => {
  const WASHER_ROUTES: readonly [string, string][] = [
    ['GET', '/api/v1/washer/jobs/offers'],
    ['GET', '/api/v1/washer/jobs/active'],
    ['GET', '/api/v1/washer/services'],
    ['GET', '/api/v1/washer/earnings'],
    ['GET', '/api/v1/washer/profile'],
  ];

  it.each(WASHER_ROUTES)('%s %s is 403 for a driver token', async (method, url) => {
    asUser(h.driverId, ['driver']);

    const res = await http.request({ method: method as 'GET', url });

    expect(res.status).toBe(403);
  });

  it('is 401 with no token at all', async () => {
    actingAs.user = null;
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/jobs/offers' });
    expect(res.status).toBe(401);
  });

  it('refuses a driver requesting a wash with a washer token', async () => {
    const washerId = await seedWasher();
    const bookingId = await seedBookingWithStatus('active');

    asUser(washerId, ['washer']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/carwash/requests',
      headers: key(),
      payload: { bookingId, serviceName: 'premium_wash', vehicleType: 'car' },
    });

    expect(res.status).toBe(403);
  });
});

describe('idempotency', () => {
  it('refuses a write with no Idempotency-Key', async () => {
    await seedWasher();
    const bookingId = await seedBookingWithStatus('active');

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/carwash/requests',
      payload: { bookingId, serviceName: 'premium_wash', vehicleType: 'car' },
    });

    expect(res.status).toBe(400);
  });

  it('refuses the same key with a changed body', async () => {
    await seedWasher();
    const bookingId = await seedBookingWithStatus('active');
    const headers = key();

    asUser(h.driverId, ['driver']);
    await http.request({
      method: 'POST',
      url: '/api/v1/driver/carwash/requests',
      headers,
      payload: { bookingId, serviceName: 'premium_wash', vehicleType: 'car' },
    });
    const changed = await http.request({
      method: 'POST',
      url: '/api/v1/driver/carwash/requests',
      headers,
      payload: { bookingId, serviceName: 'quick_wipe', vehicleType: 'car' },
    });

    expect(changed.status).toBe(422);
  });
});

describe('GET /washer/profile — before registering', () => {
  it('answers 404 with the domain code the app routes on, not a bare NOT FOUND', async () => {
    // The partner app shows "Finish setting up your partner profile" on exactly
    // this code. A bare NotFoundException answers code 'ERROR', which the app
    // must treat as a failure, so an unregistered washer saw an error screen.
    const washerId = await seedUser(h, 'washer');
    asUser(washerId, ['washer']);

    const res = await http.request({ method: 'GET', url: '/api/v1/washer/profile' });

    expect(res.status).toBe(404);
    expect(errorOf(res.body).code).toBe('WASHER_PROFILE_NOT_FOUND');
  });
});

describe('the service menu', () => {
  it('returns ten rows for a partner who registered', async () => {
    const washerId = await seedUser(h, 'washer');
    asUser(washerId, ['washer']);

    const created = await http.request({
      method: 'POST',
      url: '/api/v1/washer/profile',
      headers: key(),
      payload: { partnerType: 'gig', capabilities: ['car_wash'] },
    });
    expect(created.status).toBe(201);

    const menu = await http.request({ method: 'GET', url: '/api/v1/washer/services' });
    expect(dataOf<{ services: unknown[] }>(menu.body).services).toHaveLength(10);
  });

  it('refuses a business registration with no business name', async () => {
    const washerId = await seedUser(h, 'washer');
    asUser(washerId, ['washer']);

    const res = await http.request({
      method: 'POST',
      url: '/api/v1/washer/profile',
      headers: key(),
      payload: { partnerType: 'business', capabilities: ['car_wash'] },
    });

    expect(res.status).toBe(400);
  });

  it('upserts both vehicle-type prices from one edit', async () => {
    const washerId = await seedWasher();
    asUser(washerId, ['washer']);

    const res = await http.request({
      method: 'PUT',
      url: '/api/v1/washer/services/premium_wash',
      headers: key(),
      payload: {
        carPricePaise: 44900,
        bikePricePaise: 17900,
        durationMinutes: 45,
        isActive: true,
      },
    });

    expect(res.status).toBe(200);

    const rows = await h.sql<{ vehicle_type: string; price_paise: string }[]>`
      SELECT vehicle_type, price_paise FROM wash_services
      WHERE washer_user_id = ${washerId} AND service_name = 'premium_wash'
      ORDER BY vehicle_type
    `;
    expect(rows.map((r) => [r.vehicle_type, Number(r.price_paise)])).toEqual([
      ['car', 44900],
      ['two_wheeler', 17900],
    ]);
  });

  it('refuses an edit naming a service outside the catalogue', async () => {
    const washerId = await seedWasher();
    asUser(washerId, ['washer']);

    const res = await http.request({
      method: 'PUT',
      url: '/api/v1/washer/services/ceramic_coating',
      headers: key(),
      payload: {
        carPricePaise: 99900,
        bikePricePaise: 49900,
        durationMinutes: 90,
        isActive: true,
      },
    });

    expect(res.status).toBe(400);
  });
});

describe('the offers list', () => {
  it('quotes the partner their own earnings rather than the price', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();

    asUser(washerId, ['washer']);
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/jobs/offers' });

    const offers = dataOf<{ jobId: string; earningsPaise: number }[]>(res.body);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.jobId).toBe(jobId);
    // 39900 less 20%, not 39900 and not the driver's 41336.
    expect(offers[0]?.earningsPaise).toBe(31920);
  });

  it('drops an offer once the job has been taken', async () => {
    const winner = await seedWasher();
    const loser = await seedWasher();
    const jobId = await openJob();

    await accept(jobId, winner);

    asUser(loser, ['washer']);
    const res = await http.request({ method: 'GET', url: '/api/v1/washer/jobs/offers' });

    expect(dataOf<unknown[]>(res.body)).toHaveLength(0);
  });
});

describe('the driver view', () => {
  /**
   * The amount comes from the winning partner's own menu, so before the race
   * resolves there is no number — and a screen rendering ₹0 in that window is
   * telling the driver something untrue.
   */
  it('shows no money until somebody accepts', async () => {
    await seedWasher();
    const jobId = await openJob();

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/carwash/requests/${jobId}`,
    });

    const view = dataOf<{ pricePaise: number | null; driverTotalPaise: number | null }>(res.body);
    expect(view.pricePaise).toBeNull();
    expect(view.driverTotalPaise).toBeNull();
  });

  it('shows the full breakdown once accepted', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/carwash/requests/${jobId}`,
    });

    const view = dataOf<{
      pricePaise: number;
      gstPaise: number;
      driverTotalPaise: number;
      cancellable: boolean;
      washer: { userId: string } | null;
    }>(res.body);

    expect(view.pricePaise).toBe(39900);
    expect(view.gstPaise).toBe(1436);
    expect(view.driverTotalPaise).toBe(41336);
    expect(view.cancellable).toBe(true);
    expect(view.washer?.userId).toBe(washerId);
  });

  /** How many were asked, never who — that would be a map of our supply. */
  it('reports how many partners were asked and not which', async () => {
    await seedWasher();
    await seedWasher();
    const jobId = await openJob();

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/carwash/requests/${jobId}`,
    });

    const view = dataOf<Record<string, unknown>>(res.body);
    expect(view['offeredTo']).toBe(2);
    expect(JSON.stringify(view)).not.toContain('washerUserIds');
  });

  it('answers 404 for a wash on somebody else s booking', async () => {
    await seedWasher();
    const jobId = await openJob();

    const stranger = await seedUser(h, 'driver');
    asUser(stranger, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/carwash/requests/${jobId}`,
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /driver/carwash/requests/:id/order', () => {
  it('refuses to mint an order before anybody has accepted', async () => {
    await seedWasher();
    const jobId = await openJob();

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/driver/carwash/requests/${jobId}/order`,
      headers: key(),
      payload: {},
    });

    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('WASH_NOT_PAYABLE');
  });

  it('answers 404 for somebody else s wash', async () => {
    const washerId = await seedWasher();
    const jobId = await openJob();
    await accept(jobId, washerId);

    const stranger = await seedUser(h, 'driver');
    asUser(stranger, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/driver/carwash/requests/${jobId}/order`,
      headers: key(),
      payload: {},
    });

    expect(res.status).toBe(404);
  });
});
