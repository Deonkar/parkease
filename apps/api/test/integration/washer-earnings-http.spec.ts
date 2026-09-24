import { uuidv7 } from '@parkease/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WasherEarningsQuery } from '../../src/domains/carwash/queries/washer-earnings.query.js';

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
    payload: { photoId: `parkease/proofs/${slot}-abc123` },
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

/**
 * One accept posting — the same three legs as `postWashAt` — at an exact
 * instant, for the period-bound tests that need a row a minute either side of
 * an IST midnight rather than whole days back.
 */
async function postWashAtInstant(washerId: string, at: Date): Promise<void> {
  const txnId = uuidv7();
  await h.sql`
    INSERT INTO ledger_entries
      (txn_id, account, direction, amount_paise, counterparty_user_id, description, occurred_at)
    VALUES
      (${txnId}, 'driver_receivable', 'debit', 39900, NULL, 'car wash service', ${at}),
      (${txnId}, 'owner_payable', 'credit', 31920, ${washerId}, 'car wash service', ${at}),
      (${txnId}, 'platform_revenue', 'credit', 7980, NULL, 'car wash service', ${at})
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

/**
 * Database M3 = silent failure M8, and silent failure M9 (task 14 final fix
 * wave). A completed job is paid for by a ledger posting; a line with no
 * posting behind it is a broken row. `coalesce(…, 0)` used to turn it into a
 * ₹0 line — a plausible lie on a money screen — and a response that did fail
 * its parse answered 400, blaming the partner's phone. Now it fails loudly, as
 * the server fault it is.
 */
describe('GET /washer/earnings — a missing posting fails loudly', () => {
  it('answers 500 INTERNAL_ERROR, never a ₹0 line, for a completed job with no posting', async () => {
    const washerId = await seedWasher();
    const jobId = await completeAJob(washerId);
    // Point the job at a transaction nothing was ever posted under. The
    // ledger is append-only, so this is the only way to lose a posting — and
    // it is exactly what a job whose accept posting never landed looks like.
    await h.sql`UPDATE wash_jobs SET txn_id = ${uuidv7()} WHERE id = ${jobId}`;

    const res = await earnings(washerId, '?period=all');

    expect(res.status).toBe(500);
    expect(errorOf(res.body).code).toBe('INTERNAL_ERROR');
  });

  it('still reports a zero fee for a zero-commission job, whose posting has no fee leg', async () => {
    // The one case where a missing platform_revenue leg is the ledger's true
    // answer: `leg()` drops zero-amount entries, and a 0% rate is a legal
    // `commission_rate`. Only the net's absence means a missing posting.
    const washerId = await seedWasher();
    const jobId = await completeAJob(washerId);
    const txnId = uuidv7();
    await h.sql`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, counterparty_user_id, description)
      VALUES (${txnId}, 'driver_receivable', 'debit', 39900, NULL, 'car wash service'),
             (${txnId}, 'owner_payable', 'credit', 39900, ${washerId}, 'car wash service')
    `;
    await h.sql`UPDATE wash_jobs SET txn_id = ${txnId}, commission_rate = 0 WHERE id = ${jobId}`;

    const res = await earnings(washerId, '?period=all');

    expect(res.status).toBe(200);
    const [line] = dataOf<{ lines: { feePaise: number; netPaise: number }[] }>(res.body).lines;
    expect(line).toMatchObject({ feePaise: 0, netPaise: 39900 });
  });
});

/**
 * Test adequacy 3 (task 14 final fix wave). The fee test above uses a posting
 * where fee = gross − net holds, so a query that subtracted instead of reading
 * the ledger would pass it. This posting breaks the identity on purpose.
 */
describe('GET /washer/earnings — the lines are the ledger, not arithmetic', () => {
  /**
   * Found while writing the test below. The per-line subqueries were written
   * `${ledgerEntries.txnId} = ${washJobs.txnId}`, and Drizzle renders both as a
   * bare "txn_id" inside a select field — so the correlation read
   * `"txn_id" = "txn_id"`, true for every row. Each line's fee was every
   * platform_revenue credit in the ledger and each net was all of this
   * partner's credits. With one job the two coincide, which is why the fee
   * test above could not see it.
   */
  it('gives each line its own posting, not the sum of every posting', async () => {
    const washerId = await seedWasher();
    const first = await completeAJob(washerId);
    const second = await completeAJob(washerId, 2);

    const res = await earnings(washerId, '?period=all');

    expect(res.status).toBe(200);
    const lines = dataOf<{ lines: { jobId: string; feePaise: number; netPaise: number }[] }>(
      res.body,
    ).lines;
    expect(lines.map((l) => l.jobId).sort()).toEqual([first, second].sort());
    for (const line of lines) {
      expect(line).toMatchObject({ feePaise: 7980, netPaise: 31920 });
    }
  });

  it('reports a second platform_revenue leg as fee, and the job price as gross, unchanged', async () => {
    const washerId = await seedWasher();
    const jobId = await completeAJob(washerId);
    const [job] = await h.sql<
      { txn_id: string }[]
    >`SELECT txn_id FROM wash_jobs WHERE id = ${jobId}`;
    if (job === undefined) throw new Error('job vanished');
    // A balanced pair on the SAME transaction: 500 more to platform_revenue.
    // Gross stays 39900 (the job's price) and net stays 31920 (this partner's
    // credit), so fee = gross − net would still say 7980. The ledger says 8480.
    await h.sql`
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, counterparty_user_id, description)
      VALUES (${job.txn_id}, 'driver_receivable', 'debit', 500, NULL, 'car wash adjustment'),
             (${job.txn_id}, 'platform_revenue', 'credit', 500, NULL, 'car wash adjustment')
    `;

    const res = await earnings(washerId, '?period=all');

    expect(res.status).toBe(200);
    expect(dataOf<{ lines: unknown[] }>(res.body).lines).toEqual([
      expect.objectContaining({ jobId, grossPaise: 39900, feePaise: 8480, netPaise: 31920 }),
    ]);
  });
});

/**
 * Test adequacy 4 (task 14 final fix wave). The bounds are IST, and the only
 * instants that tell IST from UTC are the five and a half hours after an IST
 * midnight — which is where these tests put their rows.
 */
describe('GET /washer/earnings — period bounds are Asia/Kolkata', () => {
  /** The start of this IST day / week / month, plus an offset in minutes, as an instant. */
  const istStart = async (unit: 'day' | 'week' | 'month', minutes: number): Promise<Date> => {
    const [row] = await h.sql<{ at: Date }[]>`
      SELECT (date_trunc(${unit}, now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
             + make_interval(mins => ${minutes}) AS at
    `;
    if (row === undefined) throw new Error('no instant');
    return row.at;
  };

  it('counts a posting at Monday 01:00 IST in this week, and one at Sunday 23:00 IST in the last', async () => {
    // Monday 01:00 IST is Sunday 19:30 UTC: this week in IST, last week in UTC.
    const washerId = await seedWasher();
    await postWashAtInstant(washerId, await istStart('week', 60));
    await postWashAtInstant(washerId, await istStart('week', -60));

    const res = await earnings(washerId, '?period=week');

    expect(res.status).toBe(200);
    expect(dataOf<{ summary: Summary }>(res.body).summary).toMatchObject({
      grossPaise: 31920,
      netPaise: 31920,
    });
  });

  it('puts a job completed just after IST midnight in today, and one just before it out', async () => {
    const washerId = await seedWasher();
    const afterMidnight = await completeAJob(washerId);
    const beforeMidnight = await completeAJob(washerId, 2);
    // 00:01 IST is 18:31 UTC the previous day — today only in IST.
    const justAfter = await istStart('day', 1);
    const justBefore = await istStart('day', -1);
    await h.sql`UPDATE wash_jobs SET completed_at = ${justAfter} WHERE id = ${afterMidnight}`;
    await h.sql`UPDATE wash_jobs SET completed_at = ${justBefore} WHERE id = ${beforeMidnight}`;

    const today = await earnings(washerId, '?period=today');
    const week = await earnings(washerId, '?period=week');

    expect(today.status).toBe(200);
    expect(dataOf<{ lines: { jobId: string }[] }>(today.body).lines.map((l) => l.jobId)).toEqual([
      afterMidnight,
    ]);

    // Yesterday 23:59 IST is in this week unless today is Monday in IST, when
    // it is last week's Sunday. Both answers are asserted, never skipped.
    const [dow] = await h.sql<{ isodow: number }[]>`
      SELECT extract(isodow FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS isodow
    `;
    const weekIds = dataOf<{ lines: { jobId: string }[] }>(week.body).lines.map((l) => l.jobId);
    expect(week.status).toBe(200);
    expect(weekIds).toEqual(dow?.isodow === 1 ? [afterMidnight] : [afterMidnight, beforeMidnight]);
  });

  it('answers 200 for period=month, with this month’s job in it', async () => {
    const washerId = await seedWasher();
    const jobId = await completeAJob(washerId);
    const monthStart = await istStart('month', 1);
    await h.sql`UPDATE wash_jobs SET completed_at = ${monthStart} WHERE id = ${jobId}`;

    const res = await earnings(washerId, '?period=month');

    expect(res.status).toBe(200);
    const view = dataOf<{ period: string; lines: { jobId: string }[] }>(res.body);
    expect(view.period).toBe('month');
    expect(view.lines.map((l) => l.jobId)).toEqual([jobId]);
  });
});

/**
 * Database L7 (task 14 final fix wave). The summary and the lines are two
 * queries; each one's `now()` was its own statement's, so a request straddling
 * IST midnight could bound the two halves of one response by two different
 * days. One read-only transaction gives both queries one snapshot and one
 * `now()`. Asserted on the database handle the query is given: every read goes
 * through a single `transaction` call in read-only mode, none straight to the
 * pool.
 */
describe('WasherEarningsQuery — one snapshot', () => {
  it('runs the summary and the lines inside one read-only transaction', async () => {
    const washerId = await seedWasher();
    await completeAJob(washerId);

    const calls: { method: string; config: unknown }[] = [];
    const watched = new Proxy(h.db, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if ((property === 'select' || property === 'transaction') && typeof value === 'function') {
          return (...args: unknown[]) => {
            calls.push({ method: property, config: args[1] });
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });

    const view = await new WasherEarningsQuery(watched).forWasher(washerId, 'week');

    expect(view.lines).toHaveLength(1);
    expect(calls).toEqual([
      { method: 'transaction', config: expect.objectContaining({ accessMode: 'read only' }) },
    ]);
  });
});
