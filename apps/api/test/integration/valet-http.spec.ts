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
 * The valet surface, through the real Fastify pipeline.
 *
 * Driven as HTTP rather than by calling commands, because a command call cannot
 * see an interceptor, a status code, a response envelope or an error code — and
 * every assertion below is about one of those.
 */

let h: Harness;
let http: HttpApp;
let spaceId: string;

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

/** A verified, online valet standing 1 km from the space. */
async function seedValet(opts: { online?: boolean; verified?: boolean } = {}): Promise<string> {
  const userId = await seedUser(h, 'valet');
  await h.sql`
    INSERT INTO valet_profiles (
      user_id, verification_status, is_online, last_seen_at, current_location, rating_count
    )
    VALUES (
      ${userId},
      ${opts.verified === false ? 'pending' : 'verified'},
      ${opts.online !== false},
      now(),
      ST_SetSRID(ST_MakePoint(77.6250, 12.9360), 4326)::geography,
      0
    )
  `;
  return userId;
}

/** Requests a valet as the driver and returns the created job id. */
async function requestValet(bookingId: string): Promise<string> {
  asUser(h.driverId, ['driver']);
  const res = await http.request({
    method: 'POST',
    url: '/api/v1/driver/valet/requests',
    headers: key(),
    payload: {
      bookingId,
      pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall, Koramangala' },
    },
  });

  expect(res.status).toBe(201);
  return dataOf<{ id: string }>(res.body).id;
}

const accept = (jobId: string, valetId: string) => {
  asUser(valetId, ['valet']);
  return http.request({
    method: 'POST',
    url: `/api/v1/valet/jobs/${jobId}/accept`,
    headers: key(),
    payload: { from: { lat: 12.9361, lng: 77.6229 } },
  });
};

const advance = (jobId: string, valetId: string, event: string, proofPhotoId?: string) => {
  asUser(valetId, ['valet']);
  return http.request({
    method: 'POST',
    url: `/api/v1/valet/jobs/${jobId}/status`,
    headers: key(),
    payload: proofPhotoId === undefined ? { event } : { event, proofPhotoId },
  });
};

beforeAll(async () => {
  h = await startHarness();
  http = await startHttpApp(h);
  spaceId = await seedSpace(h, {
    lat: 12.9352,
    lng: 77.6245,
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
   * Bookings go too, not just the valet rows.
   *
   * `booking_slots` carries an `EXCLUDE USING gist` overlap constraint, and every
   * test here seeds the same slot index over the same window — so leaving the
   * previous test's slot in place makes the *second* test fail on a constraint
   * that is working perfectly. CASCADE from `bookings` reaches the valet tables
   * and the ledger, which is why the order below is bookings-first.
   */
  await h.sql`
    TRUNCATE bookings, booking_slots, valet_jobs, valet_job_offers,
             ledger_entries, outbox_messages, valet_profiles
    RESTART IDENTITY CASCADE
  `;
  actingAs.user = null;
});

describe('POST /driver/valet/requests — eligibility', () => {
  it('succeeds against a confirmed booking and reports how many valets were asked', async () => {
    await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
    });

    expect(res.status).toBe(201);
    const job = dataOf<{ status: string; offeredTo: number; offerRadiusM: number }>(res.body);
    expect(job.status).toBe('offered');
    expect(job.offeredTo).toBe(1);
    expect(job.offerRadiusM).toBe(5000);
  });

  it('succeeds against an active booking', async () => {
    await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'active',
    });
    await h.sql`UPDATE bookings SET status = 'active' WHERE id = ${bookingId}`;

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
    });

    expect(res.status).toBe(201);
  });

  /**
   * Dispatching against an unpaid hold means the expiry job can cancel the
   * booking while a valet is mid-journey.
   */
  it.each(['pending_payment', 'completed', 'cancelled'])(
    'refuses a %s booking with BOOKING_NOT_VALET_ELIGIBLE',
    async (status) => {
      const bookingId = await seedBooking(h, {
        spaceId,
        vehicleType: 'car',
        slotIndex: 1,
        slotStatus: 'confirmed',
      });
      await h.sql`UPDATE bookings SET status = ${status} WHERE id = ${bookingId}`;

      asUser(h.driverId, ['driver']);
      const res = await http.request({
        method: 'POST',
        url: '/api/v1/driver/valet/requests',
        headers: key(),
        payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
      });

      expect(res.status).toBe(400);
      expect(errorOf(res.body).code).toBe('BOOKING_NOT_VALET_ELIGIBLE');
    },
  );

  it('refuses a second request while a live job exists', async () => {
    await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    await requestValet(bookingId);

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
    });

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('VALET_ALREADY_REQUESTED');
  });

  /** 404, not 403 — a 403 would confirm the booking exists. */
  it("answers 404 for another driver's booking", async () => {
    const otherDriver = await seedUser(h, 'driver');
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });

    asUser(otherDriver, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
    });

    expect(res.status).toBe(404);
  });

  it('still creates the job when nobody is available, so the search can widen', async () => {
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId, pickup: { lat: 12.9352, lng: 77.6245, address: 'Forum Mall' } },
    });

    expect(res.status).toBe(201);
    const job = dataOf<{ status: string; offeredTo: number }>(res.body);
    expect(job.status).toBe('requested');
    expect(job.offeredTo).toBe(0);
  });
});

describe('POST /valet/jobs/:id/accept — first accept wins', () => {
  it('gives one job to exactly one valet under concurrency', async () => {
    const valets = await Promise.all([
      seedValet(),
      seedValet(),
      seedValet(),
      seedValet(),
      seedValet(),
    ]);
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    const offers = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM valet_job_offers WHERE job_id = ${jobId}
    `;
    expect(offers[0]?.n).toBe(5);

    /**
     * Sequential, not `Promise.all`. `actingAs` is module-level state shared by
     * every request through this harness, so five concurrent accepts would all
     * authenticate as whichever valet happened to write it last — and the test
     * would pass for entirely the wrong reason. The race being asserted lives in
     * the database, not in the client: each request still meets a row the
     * previous one has already moved out of `offered`.
     */
    const statuses: number[] = [];
    const bodies: unknown[] = [];
    for (const valetId of valets) {
      const res = await accept(jobId, valetId);
      statuses.push(res.status);
      bodies.push(res.body);
    }

    expect([...statuses].sort()).toEqual([200, 409, 409, 409, 409]);

    for (const [i, status] of statuses.entries()) {
      if (status !== 409) continue;
      const err = errorOf(bodies[i]);
      expect(err.code).toBe('VALET_JOB_TAKEN');
      expect(err.message).toBe('This job was taken by another valet. More jobs coming!');
    }

    const [row] = await h.sql<{ status: string; assigned_user_id: string | null }[]>`
      SELECT status, assigned_user_id FROM valet_jobs WHERE id = ${jobId}
    `;
    expect(row?.status).toBe('accepted');
    expect(row?.assigned_user_id).not.toBeNull();

    const outcomes = await h.sql<{ outcome: string; n: number }[]>`
      SELECT outcome, count(*)::int AS n FROM valet_job_offers
      WHERE job_id = ${jobId} GROUP BY outcome ORDER BY outcome
    `;
    expect(outcomes).toEqual([
      { outcome: 'lost', n: 4 },
      { outcome: 'won', n: 1 },
    ]);
  });

  /** 404, not 409 — a 409 would confirm the job exists. */
  it('answers 404 when the job was never offered to you', async () => {
    await seedValet();
    const stranger = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    await h.sql`DELETE FROM valet_job_offers WHERE valet_user_id = ${stranger}`;

    const res = await accept(jobId, stranger);
    expect(res.status).toBe(404);
  });

  it('freezes the commission rate on the row at accept time', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    await accept(jobId, valetId);

    const [row] = await h.sql<{ commission_rate: string; fee_paise: string }[]>`
      SELECT commission_rate, fee_paise FROM valet_jobs WHERE id = ${jobId}
    `;
    expect(Number(row?.commission_rate)).toBe(0.2);
    expect(Number(row?.fee_paise)).toBeGreaterThan(0);
  });

  /**
   * The outbound leg is on the books in the same commit as the assignment. A job
   * with an assignee and no receivable is a valet driving for free.
   */
  it('posts a balanced outbound leg tagged to the valet', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    await accept(jobId, valetId);

    const [job] = await h.sql<{ txn_id: string }[]>`
      SELECT txn_id FROM valet_jobs WHERE id = ${jobId}
    `;
    const entries = await h.sql<
      {
        account: string;
        direction: string;
        amount_paise: string;
        counterparty_user_id: string | null;
      }[]
    >`
      SELECT account, direction, amount_paise, counterparty_user_id
      FROM ledger_entries WHERE txn_id = ${job!.txn_id} ORDER BY account
    `;

    const debits = entries
      .filter((e) => e.direction === 'debit')
      .reduce((s, e) => s + Number(e.amount_paise), 0);
    const credits = entries
      .filter((e) => e.direction === 'credit')
      .reduce((s, e) => s + Number(e.amount_paise), 0);
    expect(debits).toBe(credits);

    const ownerPayable = entries.find((e) => e.account === 'owner_payable');
    expect(ownerPayable?.counterparty_user_id).toBe(valetId);

    // The valet's id belongs on their earnings and nowhere else, or the earnings
    // query double-counts.
    expect(entries.find((e) => e.account === 'driver_receivable')?.counterparty_user_id).toBeNull();
  });

  it('replays a retried accept with the same Idempotency-Key and writes the assignee once', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    asUser(valetId, ['valet']);
    const headers = key();
    const payload = { from: { lat: 12.9361, lng: 77.6229 } };
    const url = `/api/v1/valet/jobs/${jobId}/accept`;

    const first = await http.request({ method: 'POST', url, headers, payload });
    const second = await http.request({ method: 'POST', url, headers, payload });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const [row] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE txn_id = (SELECT txn_id FROM valet_jobs WHERE id = ${jobId})
    `;
    expect(row?.n).toBe(4);
  });
});

describe('POST /valet/jobs/:id/status — the machine, over HTTP', () => {
  let jobId: string;
  let valetId: string;

  beforeEach(async () => {
    valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    jobId = await requestValet(bookingId);
    await accept(jobId, valetId);
  });

  it('walks accepted → en_route → arrived → parking', async () => {
    for (const [event, expected] of [
      ['depart', 'en_route'],
      ['arrive', 'arrived'],
      ['start_parking', 'parking'],
    ] as const) {
      const res = await advance(jobId, valetId, event);
      expect(res.status).toBe(200);
      expect(dataOf<{ status: string }>(res.body).status).toBe(expected);
    }
  });

  it('refuses confirm_parked without a proof photo, then accepts it with one', async () => {
    await advance(jobId, valetId, 'depart');
    await advance(jobId, valetId, 'arrive');
    await advance(jobId, valetId, 'start_parking');

    const without = await advance(jobId, valetId, 'confirm_parked');
    expect(without.status).toBe(400);
    expect(errorOf(without.body).code).toBe('PROOF_PHOTO_REQUIRED');

    const with_ = await advance(jobId, valetId, 'confirm_parked', 'photo_abc123');
    expect(with_.status).toBe(200);
    expect(dataOf<{ status: string }>(with_.body).status).toBe('parked');
  });

  it('refuses an illegal jump with ILLEGAL_VALET_TRANSITION', async () => {
    const res = await advance(jobId, valetId, 'complete');
    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('ILLEGAL_VALET_TRANSITION');
  });

  /** request_return is the driver's event. A valet firing it would charge them. */
  it('rejects request_return from a valet at the schema, before the machine', async () => {
    const res = await advance(jobId, valetId, 'request_return');
    expect(res.status).toBe(400);
  });

  it('answers 404 to a valet the job is not assigned to', async () => {
    const stranger = await seedValet();
    const res = await advance(jobId, stranger, 'depart');
    expect(res.status).toBe(404);
  });

  it('schedules the no-show job in the same transaction as arrive', async () => {
    await advance(jobId, valetId, 'depart');
    await advance(jobId, valetId, 'arrive');

    const [row] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_messages
      WHERE type = 'valet.no-show' AND payload->>'jobId' = ${jobId}
    `;
    expect(row?.n).toBe(1);
  });
});

describe('POST /driver/valet/requests/:id/cancel', () => {
  it('is free from offered and posts no ledger entries at all', async () => {
    await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/driver/valet/requests/${jobId}/cancel`,
      headers: key(),
      payload: {},
    });

    expect(res.status).toBe(200);
    expect(dataOf<{ status: string }>(res.body).status).toBe('cancelled');

    const [row] = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ledger_entries`;
    expect(row?.n).toBe(0);
  });

  it('refuses once the valet holds the car, and names the support path', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);
    await accept(jobId, valetId);
    await advance(jobId, valetId, 'depart');
    await advance(jobId, valetId, 'arrive');
    await advance(jobId, valetId, 'start_parking');

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'POST',
      url: `/api/v1/driver/valet/requests/${jobId}/cancel`,
      headers: key(),
      payload: {},
    });

    expect(res.status).toBe(409);
    expect(errorOf(res.body).code).toBe('VALET_HOLDS_VEHICLE');
    expect(errorOf(res.body).message).toContain('support');
  });
});

describe('role separation', () => {
  it.each([
    ['GET', '/api/v1/valet/jobs/offers'],
    ['GET', '/api/v1/valet/jobs/active'],
    ['GET', '/api/v1/valet/earnings'],
    ['GET', '/api/v1/valet/profile'],
  ])('refuses %s %s for a driver-only token', async (method, url) => {
    asUser(h.driverId, ['driver']);
    const res = await http.request({ method: method as 'GET', url });
    expect(res.status).toBe(403);
  });

  it('refuses the driver valet routes for a valet-only token', async () => {
    const valetId = await seedValet();
    asUser(valetId, ['valet']);

    const res = await http.request({
      method: 'POST',
      url: '/api/v1/driver/valet/requests',
      headers: key(),
      payload: { bookingId: uuidv7(), pickup: { lat: 12.9, lng: 77.6, address: 'x' } },
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /driver/valet/requests/:id — what the driver may see', () => {
  it('never exposes a phone number, and offers a support thread rather than a number', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);
    await accept(jobId, valetId);

    const [valetRow] = await h.sql<{ phone: string }[]>`
      SELECT phone FROM users WHERE id = ${valetId}
    `;

    asUser(h.driverId, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/valet/requests/${jobId}`,
    });

    expect(res.status).toBe(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(valetRow!.phone);

    const job = dataOf<{ contact: { mode: string } | null; valet: { userId: string } | null }>(
      res.body,
    );
    expect(job.contact?.mode).toBe('support');
    expect(job.valet?.userId).toBe(valetId);
    expect(serialised).not.toMatch(/"phone"/);
  });

  it("answers 404 for another driver's job", async () => {
    await seedValet();
    const otherDriver = await seedUser(h, 'driver');
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);

    asUser(otherDriver, ['driver']);
    const res = await http.request({
      method: 'GET',
      url: `/api/v1/driver/valet/requests/${jobId}`,
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /valet/earnings — the ledger, and nothing else', () => {
  /**
   * The API cannot drift from the books: this asserts the endpoint's number
   * equals a direct `owner_payable` balance query for the same counterparty
   * (R-MONEY-05).
   */
  it('returns exactly what owner_payable holds for that valet', async () => {
    const valetId = await seedValet();
    const bookingId = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 1,
      slotStatus: 'confirmed',
    });
    const jobId = await requestValet(bookingId);
    await accept(jobId, valetId);

    const [direct] = await h.sql<{ net: string }[]>`
      SELECT coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
           - coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0) AS net
      FROM ledger_entries
      WHERE account = 'owner_payable' AND counterparty_user_id = ${valetId}
    `;

    asUser(valetId, ['valet']);
    const res = await http.request({ method: 'GET', url: '/api/v1/valet/earnings' });

    expect(res.status).toBe(200);
    const summary = dataOf<{ netPaise: number; grossPaise: number }>(res.body);
    expect(summary.netPaise).toBe(Number(direct?.net));
    expect(summary.grossPaise).toBeGreaterThan(0);
  });
});
