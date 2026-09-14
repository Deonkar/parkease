import { searchSpacesQuerySchema } from '@parkease/contracts/driver';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  basePriceExpr,
  buildConditions,
  orderByExpr,
  originPoint,
} from '../../src/domains/space/search-sql.js';

import { startHarness, stopHarness, type Harness } from './harness.js';

/**
 * R-TEST-03's mandated performance test.
 *
 * The 10,000-space fixture is owned by another task and lives in
 * `packages/db/src/seed/perf`. Until it exists this whole suite skips rather
 * than inventing a second seeder that would drift from the real one — a
 * performance number measured against different data is worse than no number.
 */
interface PerfSeeder {
  seedPerfSpaces: (db: unknown, opts: { count: number }) => Promise<unknown>;
}

async function loadPerfSeeder(): Promise<PerfSeeder | undefined> {
  try {
    return (await import('@parkease/db/seed/perf')) as unknown as PerfSeeder;
  } catch {
    // Not built yet — a typed absence, not a swallowed error. The suite skips
    // and says so.
    return undefined;
  }
}

const seeder = await loadPerfSeeder();
const describeWithFixture = seeder === undefined ? describe.skip : describe;

const SPACE_COUNT = 10_000;
const REQUESTS = 200;

/** The Bangalore bounding box the fixture spans. */
const BOX = { latMin: 12.83, latMax: 13.14, lngMin: 77.46, lngMax: 77.78 };

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

let h: Harness;

beforeAll(async () => {
  if (seeder === undefined) return;
  h = await startHarness();
  await seeder.seedPerfSpaces(h.db, { count: SPACE_COUNT });
  await h.sql`ANALYZE spaces`;
  await h.sql`ANALYZE space_slots`;
  await h.sql`ANALYZE booking_slots`;
}, 600_000);

afterAll(async () => {
  if (h !== undefined) await stopHarness(h);
});

describeWithFixture('search performance against 10,000 spaces', () => {
  it('holds p95 under 200ms and p99 under 400ms across 200 requests', async () => {
    const durations: number[] = [];

    for (let i = 0; i < REQUESTS; i += 1) {
      const q = searchSpacesQuerySchema.parse({
        lat: BOX.latMin + Math.random() * (BOX.latMax - BOX.latMin),
        lng: BOX.lngMin + Math.random() * (BOX.lngMax - BOX.lngMin),
        radiusM: 5000,
        limit: 20,
        // Mixed filter combinations, so no single plan is being measured.
        ...(i % 3 === 0 ? { vehicleType: 'car' } : {}),
        ...(i % 4 === 0 ? { amenities: 'covered' } : {}),
        ...(i % 5 === 0 ? { minRating: 4 } : {}),
        ...(i % 7 === 0 ? { sortBy: 'price' as const } : {}),
      });

      const started = performance.now();
      await h.search.findNearby(q);
      durations.push(performance.now() - started);
    }

    const sorted = [...durations].sort((a, b) => a - b);

    expect(percentile(sorted, 95)).toBeLessThan(200);
    expect(percentile(sorted, 99)).toBeLessThan(400);
  });

  it('uses the spatial index and never sequentially scans spaces', async () => {
    const q = searchSpacesQuerySchema.parse({ lat: 12.9345, lng: 77.6266, radiusM: 5000 });
    const origin = originPoint(q.lat, q.lng);
    const basePrice = basePriceExpr(q);
    const conditions = buildConditions(q, origin, basePrice);

    const rows = await h.db.execute(sql`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT s.id,
             ST_Distance(s.location, ${origin}) AS distance_exact,
             ${basePrice}                       AS base_price_paise,
             coalesce(s.rating_avg_bp, 0)       AS rating_sort
      FROM spaces s
      LEFT JOIN space_photos ph ON ph.space_id = s.id AND ph.is_primary
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ${orderByExpr(q.sortBy)}
      LIMIT ${q.limit + 1}
    `);

    const plan = [...rows]
      .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');

    // The index is spaces_location_gix, plus the partial
    // spaces_active_location_gix — not "spaces_location_gist".
    // A GiST spatial lookup plans as either a plain Index Scan or a Bitmap
    // Index Scan; which one depends on selectivity and on what else is being
    // filtered, and both are index-backed. Requiring the plain form makes the
    // test fail on a perfectly healthy plan, so assert the index is used and
    // let the planner pick its access method.
    expect(plan).toMatch(
      /(Bitmap )?Index Scan on spaces_(active_)?location_gix|Index Scan using spaces_(active_)?location_gix/,
    );
    // The requirement that actually matters: the candidate query must never
    // read all of spaces. \b stops this matching "Seq Scan on space_photos".
    expect(plan).not.toMatch(/Seq Scan on spaces\b/);
  });

  it('serves the availability probe from the exclusion constraint index', async () => {
    const ids = await h.sql<{ id: string }[]>`SELECT id FROM spaces LIMIT 20`;

    const rows = await h.db.execute(sql`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT ss.space_id,
             count(*) FILTER (WHERE ss.vehicle_type = 'car') AS car_free
      FROM space_slots ss
      WHERE ss.space_id IN (${sql.join(
        ids.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1 FROM booking_slots bs
          WHERE bs.space_id = ss.space_id
            AND bs.vehicle_type = ss.vehicle_type
            AND bs.slot_index = ss.slot_index
            AND bs.status IN ('confirmed', 'active')
            AND bs.period && tstzrange(now(), now() + '1 hour'::interval, '[)')
        )
      GROUP BY ss.space_id
    `);

    const plan = [...rows]
      .map((row) => String((row as Record<string, unknown>)['QUERY PLAN']))
      .join('\n');

    expect(plan).toContain('booking_slots_no_overlap');
    expect(plan).not.toContain('Seq Scan on booking_slots');
  });

  it('issues exactly 2 statements on a cache miss and 1 on a hit at scale', async () => {
    const q = { lat: 12.9345, lng: 77.6266, radiusM: 5000, limit: 20 };

    h.redis.clear();
    h.statements.reset();
    await h.search.findNearby(searchSpacesQuerySchema.parse(q));
    expect(h.statements.count).toBe(2);

    h.statements.reset();
    await h.search.findNearby(searchSpacesQuerySchema.parse(q));
    expect(h.statements.count).toBe(1);
  });
});
