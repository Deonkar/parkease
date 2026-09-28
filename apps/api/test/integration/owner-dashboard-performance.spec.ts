import { LedgerAccount } from '@parkease/contracts/enums';
import {
  bookings,
  bookingSlots,
  ledgerEntries,
  spaces,
  spaceSlots,
  users,
} from '@parkease/db/schema';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { istStartOfToday, periodBound } from '../../src/domains/ledger/period-bound.js';

import { type Harness, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * Task 15's "stress test the API and system" gate.
 *
 * Modelled on `search-performance.spec.ts`: fast bulk SQL (INSERT ... SELECT
 * generate_series), never one round trip per row, real timings reported via
 * console.info, generous tripwires rather than SLO assertions.
 *
 * Every request goes through `http-harness.ts` — the real guard, interceptor
 * and envelope stack — not a bare call into the query classes, because a
 * regression in the auth/idempotency/transform layer is exactly the kind of
 * thing a query-level benchmark cannot see.
 *
 * Never `parkease_dev` (R-ENV-06 / ADR-022): this seeds and measures against
 * `startHarness()`'s own Testcontainers `parkease_test` database only.
 */

const TARGET_HISTORICAL_COUNT = 9_300;
const TARGET_LIVE_COUNT = 700;
const NOISE_HISTORICAL_COUNT = 48_500;
const NOISE_LIVE_COUNT = 1_500;

const BANGALORE = { latMin: 12.83, latMax: 13.14, lngMin: 77.46, lngMax: 77.78 };

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

interface CohortOptions {
  readonly count: number;
  /** SQL producing `status` from the `gs` generate_series column. */
  readonly statusCase: string;
  /** SQL producing `slot_status` from the cohort's own `status` column. */
  readonly slotStatusCase: string;
  /** SQL boolean expression, from `status`, for whether a reversal is posted. */
  readonly needsReversal: string;
  /** SQL producing `starts_at` from `gs`. */
  readonly startsAtExpr: string;
  readonly maxDurationHours: number;
  readonly slotSpaceIds: readonly string[];
  readonly slotIndices: readonly number[];
  readonly driverIds: readonly string[];
}

/**
 * One set-based statement: bookings, their booking_slots, and balanced
 * ledger_entries (credit owner_payable / debit driver_receivable, plus a
 * reversing pair for the ~10% that need one) — chained through
 * data-modifying CTEs so it is one round trip regardless of `count`.
 *
 * Every row is stamped with the booking's driver as `counterparty_user_id`,
 * as create-booking and the reversal paths stamp it. `OwnerBalanceQuery`
 * counts only those rows (washer/valet legs share the account), so an
 * unstamped fixture would measure an empty statement.
 *
 * Slot assignment cycles deterministically through `slotSpaceIds` /
 * `slotIndices` by `gs`, so `booking_slots_no_overlap` (EXCLUDE USING gist,
 * scoped to status IN ('confirmed','active')) never fires: a cohort whose
 * `slotStatusCase` can produce 'confirmed' or 'active' must also space
 * repeat visits to the same slot further apart than `maxDurationHours` in
 * its `startsAtExpr` — see the two "live" cohorts below.
 */
async function insertBookingCohort(h: Harness, opts: CohortOptions): Promise<void> {
  const totalSlots = opts.slotSpaceIds.length;
  const totalDrivers = opts.driverIds.length;

  const query = `
    WITH plan AS (
      SELECT
        gs,
        uuidv7() AS booking_id,
        uuidv7() AS txn_id,
        uuidv7() AS reversal_txn_id,
        ($1::uuid[])[1 + ((gs - 1) % ${String(totalDrivers)})] AS driver_id,
        ($2::uuid[])[1 + ((gs - 1) % ${String(totalSlots)})] AS space_id,
        ($3::int[])[1 + ((gs - 1) % ${String(totalSlots)})] AS slot_index,
        (${opts.statusCase}) AS status,
        (${opts.startsAtExpr}) AS starts_at,
        (1 + floor(random() * ${String(opts.maxDurationHours)}))::int AS duration_hours,
        (2000 + floor(random() * 6000))::bigint AS base_paise
      FROM generate_series(1, ${String(opts.count)}) gs
    ),
    priced AS (
      SELECT
        gs, booking_id, txn_id, reversal_txn_id, driver_id, space_id, slot_index, status,
        starts_at,
        starts_at + (duration_hours || ' hours')::interval AS ends_at,
        base_paise,
        (base_paise * 15 / 100)::bigint AS fee_paise,
        ((base_paise * 15 / 100) * 18 / 100)::bigint AS gst_paise,
        starts_at AS occurred_at,
        (${opts.needsReversal}) AS needs_reversal,
        (${opts.slotStatusCase}) AS slot_status
      FROM plan
    ),
    final AS (
      SELECT *,
        (base_paise - fee_paise) AS owner_earnings_paise,
        (base_paise + gst_paise) AS total_paise
      FROM priced
    ),
    ins_bookings AS (
      INSERT INTO bookings (
        id, driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at, status,
        base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
        owner_earnings_paise
      )
      SELECT booking_id, driver_id, space_id, 'car', 'hourly', starts_at, ends_at, status,
             base_paise, 0, fee_paise, gst_paise, total_paise, owner_earnings_paise
      FROM final
      RETURNING id
    ),
    ins_slots AS (
      INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
      SELECT f.booking_id, f.space_id, 'car', f.slot_index,
             tstzrange(f.starts_at, f.ends_at, '[)'), f.slot_status
      FROM final f JOIN ins_bookings b ON b.id = f.booking_id
      RETURNING booking_id
    ),
    ins_credit AS (
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, booking_id, counterparty_user_id, description, occurred_at)
      SELECT f.txn_id, 'owner_payable', 'credit', f.owner_earnings_paise, f.booking_id, f.driver_id,
             'load-fixture booking credit', f.occurred_at
      FROM final f JOIN ins_bookings b ON b.id = f.booking_id
      WHERE f.status NOT IN ('pending_payment', 'expired')
      RETURNING booking_id
    ),
    ins_debit AS (
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, booking_id, counterparty_user_id, description, occurred_at)
      SELECT f.txn_id, 'driver_receivable', 'debit', f.owner_earnings_paise, f.booking_id, f.driver_id,
             'load-fixture booking debit', f.occurred_at
      FROM final f JOIN ins_bookings b ON b.id = f.booking_id
      WHERE f.status NOT IN ('pending_payment', 'expired')
      RETURNING booking_id
    ),
    ins_reversal_credit AS (
      INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, booking_id, counterparty_user_id, description, occurred_at)
      SELECT f.reversal_txn_id, 'driver_receivable', 'credit', f.owner_earnings_paise, f.booking_id, f.driver_id,
             'load-fixture reversal credit', f.occurred_at + interval '1 hour'
      FROM final f JOIN ins_bookings b ON b.id = f.booking_id
      WHERE f.needs_reversal
      RETURNING booking_id
    )
    INSERT INTO ledger_entries (txn_id, account, direction, amount_paise, booking_id, counterparty_user_id, description, occurred_at)
    SELECT f.reversal_txn_id, 'owner_payable', 'debit', f.owner_earnings_paise, f.booking_id, f.driver_id,
           'load-fixture reversal debit', f.occurred_at + interval '1 hour'
    FROM final f JOIN ins_bookings b ON b.id = f.booking_id
    WHERE f.needs_reversal
  `;

  await h.sql.unsafe(query, [[...opts.driverIds], [...opts.slotSpaceIds], [...opts.slotIndices]]);
}

interface SlotPool {
  readonly spaceIds: string[];
  readonly slotIndices: number[];
}

/** Reads back (space_id, slot_index) as two parallel arrays for the cohort's modulo assignment. */
async function readSlotPool(h: Harness, spaceIds: readonly string[]): Promise<SlotPool> {
  const rows = await h.sql<{ space_id: string; slot_index: number }[]>`
    SELECT space_id, slot_index FROM space_slots
    WHERE space_id = ANY(${[...spaceIds]}::uuid[])
    ORDER BY space_id, slot_index
  `;
  return { spaceIds: rows.map((r) => r.space_id), slotIndices: rows.map((r) => r.slot_index) };
}

async function seedSlots(h: Harness, spaceIds: readonly string[]): Promise<void> {
  const slotCounts = spaceIds.map(() => 2 + Math.floor(Math.random() * 5)); // 2..6
  await h.sql`
    INSERT INTO space_slots (space_id, vehicle_type, slot_index)
    SELECT space_id, 'car', slot_index
    FROM UNNEST(${[...spaceIds]}::uuid[], ${slotCounts}::int[]) AS t(space_id, slot_count)
    CROSS JOIN LATERAL generate_series(0, slot_count - 1) AS slot_index
  `;
}

interface FixtureResult {
  readonly targetSpaceId: string;
}

/**
 * One target owner (`h.ownerId`) with 20 spaces / ~10,000 bookings across the
 * last 90 days in mixed statuses, plus 5 noise owners with ~50,000 bookings
 * so an owner-scoping bug would show up as a platform-wide scan.
 */
async function seedLoadFixture(h: Harness): Promise<FixtureResult> {
  const ownerId = h.ownerId;

  // --- driver pool (300), bulk-inserted via a chained data-modifying CTE ---
  const driverRows = await h.sql<{ user_id: string }[]>`
    WITH new_drivers AS (
      INSERT INTO users (phone, firebase_uid, name)
      SELECT '+9170' || lpad(gs::text, 8, '0'), 'load-driver-' || gs, 'Load Driver ' || gs
      FROM generate_series(1, 300) gs
      RETURNING id
    )
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'driver' FROM new_drivers
    RETURNING user_id
  `;
  const driverIds = driverRows.map((r) => r.user_id);

  // --- 5 noise owners ---
  const noiseOwnerRows = await h.sql<{ user_id: string }[]>`
    WITH new_owners AS (
      INSERT INTO users (phone, firebase_uid, name)
      SELECT '+9180' || lpad(gs::text, 8, '0'), 'load-owner-' || gs, 'Load Owner ' || gs
      FROM generate_series(1, 5) gs
      RETURNING id
    )
    INSERT INTO user_roles (user_id, role)
    SELECT id, 'owner' FROM new_owners
    RETURNING user_id
  `;
  const noiseOwnerIds = noiseOwnerRows.map((r) => r.user_id);

  // --- target owner: 20 spaces, 2-6 car slots each ---
  const targetSpaceRows = await h.sql<{ id: string }[]>`
    WITH pts AS (
      SELECT gs AS i,
             ${BANGALORE.lngMin} + random() * ${BANGALORE.lngMax - BANGALORE.lngMin} AS lng,
             ${BANGALORE.latMin} + random() * ${BANGALORE.latMax - BANGALORE.latMin} AS lat
      FROM generate_series(1, 20) gs
    )
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status, rating_avg_bp, rating_count
    )
    SELECT
      ${ownerId}::uuid,
      'Load Target Space #' || i,
      '5th Cross, Koramangala', 'Bengaluru', 'Karnataka', '560034',
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      ST_GeoHash(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geometry, 6),
      '{"car":{"hourlyPaise":3000}}'::jsonb,
      '{"is24x7":true}'::jsonb,
      '[]'::jsonb,
      'active', 45000, 50
    FROM pts
    RETURNING id
  `;
  const targetSpaceIds = targetSpaceRows.map((r) => r.id);
  await seedSlots(h, targetSpaceIds);
  const targetSlots = await readSlotPool(h, targetSpaceIds);

  // --- 5 noise owners: 200 spaces total (40 each), 2-6 car slots each ---
  const noiseSpaceRows = await h.sql<{ id: string }[]>`
    WITH pts AS (
      SELECT gs AS i,
             ${BANGALORE.lngMin} + random() * ${BANGALORE.lngMax - BANGALORE.lngMin} AS lng,
             ${BANGALORE.latMin} + random() * ${BANGALORE.latMax - BANGALORE.latMin} AS lat,
             (${noiseOwnerIds}::uuid[])[1 + ((gs - 1) % 5)] AS owner_id
      FROM generate_series(1, 200) gs
    )
    INSERT INTO spaces (
      owner_id, title, address_line, city, state, pincode, location, zone_id,
      pricing, schedule, amenities, approval_status, rating_avg_bp, rating_count
    )
    SELECT
      owner_id,
      'Load Noise Space #' || i,
      '5th Cross, Koramangala', 'Bengaluru', 'Karnataka', '560034',
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      ST_GeoHash(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geometry, 6),
      '{"car":{"hourlyPaise":3000}}'::jsonb,
      '{"is24x7":true}'::jsonb,
      '[]'::jsonb,
      'active', 45000, 50
    FROM pts
    RETURNING id
  `;
  const noiseSpaceIds = noiseSpaceRows.map((r) => r.id);
  await seedSlots(h, noiseSpaceIds);
  const noiseSlots = await readSlotPool(h, noiseSpaceIds);

  // --- target owner bookings: historical (no exclusion concern — slot status
  // is 'released'/'held') then live (confirmed/active — spaced by slot cycle
  // so booking_slots_no_overlap never fires) ---
  await insertBookingCohort(h, {
    count: TARGET_HISTORICAL_COUNT,
    statusCase: `
      CASE
        WHEN gs <= 7000 THEN 'completed'
        WHEN gs <= 8000 THEN 'cancelled'
        WHEN gs <= 8500 THEN 'no_show'
        WHEN gs <= 9000 THEN 'pending_payment'
        ELSE 'expired'
      END
    `,
    slotStatusCase: `CASE WHEN status IN ('completed', 'cancelled', 'no_show') THEN 'released' ELSE 'held' END`,
    needsReversal: `status = 'cancelled'`,
    startsAtExpr: `now() - make_interval(days => floor(random() * 90)::int, hours => floor(random() * 20)::int)`,
    maxDurationHours: 4,
    slotSpaceIds: targetSlots.spaceIds,
    slotIndices: targetSlots.slotIndices,
    driverIds,
  });

  await insertBookingCohort(h, {
    count: TARGET_LIVE_COUNT,
    statusCase: `CASE WHEN gs <= 500 THEN 'confirmed' ELSE 'active' END`,
    slotStatusCase: `status`,
    needsReversal: `false`,
    startsAtExpr: `(now() - interval '2 hours') + make_interval(hours => (((gs - 1) / ${String(targetSlots.spaceIds.length)}) * 6))`,
    maxDurationHours: 3,
    slotSpaceIds: targetSlots.spaceIds,
    slotIndices: targetSlots.slotIndices,
    driverIds,
  });

  // --- noise: 5 owners, ~50,000 bookings ---
  await insertBookingCohort(h, {
    count: NOISE_HISTORICAL_COUNT,
    statusCase: `CASE WHEN gs <= 46000 THEN 'completed' ELSE 'cancelled' END`,
    slotStatusCase: `CASE WHEN status IN ('completed', 'cancelled') THEN 'released' ELSE 'held' END`,
    needsReversal: `status = 'cancelled'`,
    startsAtExpr: `now() - make_interval(days => floor(random() * 90)::int, hours => floor(random() * 20)::int)`,
    maxDurationHours: 4,
    slotSpaceIds: noiseSlots.spaceIds,
    slotIndices: noiseSlots.slotIndices,
    driverIds,
  });

  await insertBookingCohort(h, {
    count: NOISE_LIVE_COUNT,
    statusCase: `CASE WHEN gs <= 1000 THEN 'confirmed' ELSE 'active' END`,
    slotStatusCase: `status`,
    needsReversal: `false`,
    startsAtExpr: `(now() - interval '2 hours') + make_interval(hours => (((gs - 1) / ${String(noiseSlots.spaceIds.length)}) * 6))`,
    maxDurationHours: 3,
    slotSpaceIds: noiseSlots.spaceIds,
    slotIndices: noiseSlots.slotIndices,
    driverIds,
  });

  await h.sql`ANALYZE spaces, space_slots, booking_slots, bookings, ledger_entries`;

  const first = targetSpaceIds[0];
  if (first === undefined) throw new Error('seedLoadFixture: no target spaces created');
  return { targetSpaceId: first };
}

// --- HTTP measurement helpers ------------------------------------------------

interface EndpointStats {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly burstWallMs: number;
  readonly burstMaxMs: number;
}

async function measureEndpoint(
  request: () => Promise<{ status: number; body: unknown }>,
  assertBody: (body: unknown) => void,
): Promise<EndpointStats> {
  const durations: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    const started = performance.now();
    const res = await request();
    durations.push(performance.now() - started);
    expect(res.status).toBe(200);
    assertBody(res.body);
  }
  const sorted = [...durations].sort((a, b) => a - b);

  const burstStarted = performance.now();
  const burst = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const t0 = performance.now();
      const res = await request();
      return { res, dt: performance.now() - t0 };
    }),
  );
  const burstWallMs = performance.now() - burstStarted;
  for (const { res } of burst) {
    expect(res.status).toBe(200);
    assertBody(res.body);
  }

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? 0,
    burstWallMs,
    burstMaxMs: Math.max(...burst.map((b) => b.dt)),
  };
}

function printResultsTable(results: ReadonlyMap<string, EndpointStats>): void {
  const fmt = (n: number) => n.toFixed(1).padStart(8);
  // eslint-disable-next-line no-console -- load-test output, meant for pasting into the PR body
  console.info(
    '\nendpoint                                  p50ms     p95ms     maxms  burstWallMs burstMaxMs',
  );
  for (const [name, r] of results) {
    // eslint-disable-next-line no-console -- load-test output, meant for pasting into the PR body
    console.info(
      `${name.padEnd(42)} ${fmt(r.p50)} ${fmt(r.p95)} ${fmt(r.max)} ${fmt(r.burstWallMs)} ${fmt(r.burstMaxMs)}`,
    );
  }
}

describe('owner dashboard, earnings and bookings under load', () => {
  let h: Harness;
  let http: HttpApp;
  let targetSpaceId: string;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    ({ targetSpaceId } = await seedLoadFixture(h));
    actingAs.user = { id: h.ownerId, roles: ['owner'], activeRole: 'owner' };
  }, 900_000);

  afterAll(async () => {
    actingAs.user = null;
    await stopHttpApp(http);
    await stopHarness(h);
  });

  const get = (url: string) => http.request({ method: 'GET', url: `/api/v1${url}` });

  it('answers every endpoint within budget under sequential and burst load', async () => {
    const results = new Map<string, EndpointStats>();
    const hasData = (body: unknown): body is { data: unknown } =>
      body !== null && typeof body === 'object' && 'data' in body;

    results.set(
      'GET /owner/dashboard',
      await measureEndpoint(
        () => get('/owner/dashboard'),
        (body) => expect(hasData(body)).toBe(true),
      ),
    );

    results.set(
      'GET /owner/earnings?period=month',
      await measureEndpoint(
        () => get('/owner/earnings?period=month'),
        (body) => expect(hasData(body)).toBe(true),
      ),
    );

    results.set(
      'GET /owner/earnings/transactions (page 1)',
      await measureEndpoint(
        () => get('/owner/earnings/transactions?period=month'),
        (body) => {
          expect(hasData(body)).toBe(true);
          expect(body).toHaveProperty('meta.hasMore');
        },
      ),
    );

    // Walk the cursor ~20 pages in before measuring the deep page, so the
    // deep-page numbers reflect a real keyset offset rather than page 1
    // measured twice.
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const url =
        cursor === undefined
          ? '/owner/earnings/transactions?period=month'
          : `/owner/earnings/transactions?period=month&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(url);
      expect(res.status).toBe(200);
      const meta = (res.body as { meta: { nextCursor: string | null; hasMore: boolean } }).meta;
      if (!meta.hasMore || meta.nextCursor === null) break;
      cursor = meta.nextCursor;
    }
    expect(
      cursor,
      'expected the month period to have at least 20 pages of transactions',
    ).toBeDefined();
    const deepCursor = cursor;

    results.set(
      'GET /owner/earnings/transactions (page ~20)',
      await measureEndpoint(
        () =>
          get(
            `/owner/earnings/transactions?period=month&cursor=${encodeURIComponent(deepCursor ?? '')}`,
          ),
        (body) => {
          expect(hasData(body)).toBe(true);
          expect(body).toHaveProperty('meta.hasMore');
        },
      ),
    );

    results.set(
      'GET /owner/bookings?group=past',
      await measureEndpoint(
        () => get('/owner/bookings?group=past'),
        (body) => {
          expect(hasData(body)).toBe(true);
          expect(body).toHaveProperty('meta.hasMore');
        },
      ),
    );

    results.set(
      'GET /owner/spaces/:id/bookings?group=past',
      await measureEndpoint(
        () => get(`/owner/spaces/${targetSpaceId}/bookings?group=past`),
        (body) => {
          expect(hasData(body)).toBe(true);
          expect(body).toHaveProperty('meta.hasMore');
        },
      ),
    );

    printResultsTable(results);

    for (const [name, r] of results) {
      // A gross-regression tripwire, not an SLO: generous on purpose so this
      // never flakes on a laptop under load.
      expect(r.p95, name).toBeLessThan(1500);
    }
  }, 180_000);

  it('EXPLAIN shows the statement page and occupancy query plans', async () => {
    // The exact query `OwnerBalanceQuery.statementQuery` + `.statementPage`
    // build (owner-balance.ts), reconstructed here since that
    // method is private — same shape, same joins, same having/order/limit.
    const CREDITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
        filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`;
    const DEBITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
        filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`;
    const firstCredit = sql`date_trunc('milliseconds', min(${ledgerEntries.occurredAt}))`.mapWith(
      ledgerEntries.occurredAt,
    );
    const UNPAID = ['pending_payment', 'expired'] as const;

    const statementQuery = h.db
      .select({
        bookingId: bookings.id,
        occurredAt: firstCredit,
        driverName: users.name,
        spaceName: spaces.title,
        durationType: bookings.durationType,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        basePaise: bookings.basePaise,
        creditsPaise: CREDITS,
        debitsPaise: DEBITS,
      })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(users, eq(users.id, bookings.driverId))
      .where(
        and(
          eq(spaces.ownerId, h.ownerId),
          eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE),
          eq(ledgerEntries.counterpartyUserId, bookings.driverId),
          notInArray(bookings.status, [...UNPAID]),
        ),
      )
      .groupBy(bookings.id, spaces.id, users.id)
      .having(periodBound(firstCredit, 'month'))
      .orderBy(desc(firstCredit), desc(bookings.id))
      .limit(21);

    const statementPlanRows = await h.db.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${statementQuery}`);
    const statementPlan = [...statementPlanRows]
      .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');
    // eslint-disable-next-line no-console -- EXPLAIN output, meant for pasting into the PR body
    console.info('\n--- statement page EXPLAIN (top nodes) ---');
    // eslint-disable-next-line no-console -- EXPLAIN output, meant for pasting into the PR body
    console.info(statementPlan.split('\n').slice(0, 15).join('\n'));

    // The exact query `SpaceOccupancyQuery.forOwner` builds (occupancy.ts).
    const OCCUPYING = ['confirmed', 'active', 'completed'] as const;
    const now = new Date();
    const from = sql`${istStartOfToday(now).toISOString()}::timestamptz`;
    const to = sql`${now.toISOString()}::timestamptz`;

    const slotCounts = h.db
      .select({ spaceId: spaceSlots.spaceId, slots: sql<number>`count(*)::int`.as('slots') })
      .from(spaceSlots)
      .groupBy(spaceSlots.spaceId)
      .as('slot_counts');

    const booked = h.db
      .select({
        spaceId: bookingSlots.spaceId,
        hours: sql<string>`sum(extract(epoch from
            least(upper(${bookingSlots.period}), ${to}) - greatest(lower(${bookingSlots.period}), ${from})
          ) / 3600)::text`.as('hours'),
      })
      .from(bookingSlots)
      .innerJoin(bookings, eq(bookings.id, bookingSlots.bookingId))
      .where(
        and(
          inArray(bookings.status, [...OCCUPYING]),
          sql`${bookingSlots.period} && tstzrange(${from}, ${to}, '[)')`,
        ),
      )
      .groupBy(bookingSlots.spaceId)
      .as('booked');

    const occupancyQuery = h.db
      .select({
        id: spaces.id,
        title: spaces.title,
        approvalStatus: spaces.approvalStatus,
        slots: slotCounts.slots,
        hours: booked.hours,
      })
      .from(spaces)
      .leftJoin(slotCounts, eq(slotCounts.spaceId, spaces.id))
      .leftJoin(booked, eq(booked.spaceId, spaces.id))
      .where(and(eq(spaces.ownerId, h.ownerId), isNull(spaces.deletedAt)))
      .orderBy(asc(spaces.createdAt));

    const occupancyPlanRows = await h.db.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${occupancyQuery}`);
    const occupancyPlan = [...occupancyPlanRows]
      .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');
    // eslint-disable-next-line no-console -- EXPLAIN output, meant for pasting into the PR body
    console.info('\n--- occupancy EXPLAIN (top nodes) ---');
    // eslint-disable-next-line no-console -- EXPLAIN output, meant for pasting into the PR body
    console.info(occupancyPlan.split('\n').slice(0, 15).join('\n'));

    // A shape assertion, not a plan assertion: this suite reports the plan
    // for the PR rather than gating on a particular access method (see
    // search-performance.spec.ts's own note on Index vs Bitmap Index Scan).
    expect(statementPlan).toContain('Planning Time');
    expect(occupancyPlan).toContain('Planning Time');
  }, 60_000);
});
