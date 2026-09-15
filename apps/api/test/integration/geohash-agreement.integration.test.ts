import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { zoneIdFor } from '../../src/platform/geo/geohash.js';

import { seedSpace, startHarness, stopHarness, type Harness } from './harness.js';

/**
 * Surge zones are geohash cells: discovery reads `spaces.zone_id`, the task 10
 * worker writes `surge:{zoneId}`, and `platform/geo/geohash.ts` produces the key
 * the API looks up. If PostGIS and TypeScript ever disagree about which cell a
 * point is in, surge silently never applies — no error, no warning, just a
 * multiplier that is always 1.0.
 */

/** A 200-point deterministic spread over the Bangalore metropolitan bounding box. */
function bangalorePoints(count: number): { lat: number; lng: number }[] {
  const LAT_MIN = 12.83;
  const LAT_MAX = 13.14;
  const LNG_MIN = 77.46;
  const LNG_MAX = 77.78;

  // A golden-ratio lattice: deterministic, and it lands points in many
  // different cells rather than marching along one row of them.
  const golden = 0.618_033_988_749_895;
  return Array.from({ length: count }, (_unused, i) => ({
    lat: LAT_MIN + (LAT_MAX - LAT_MIN) * ((i * golden) % 1),
    lng: LNG_MIN + (LNG_MAX - LNG_MIN) * (((i * golden * golden) % 1) + 0),
  }));
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 300_000);

afterAll(async () => {
  if (h !== undefined) await stopHarness(h);
});

describe('geohash agreement between PostGIS and TypeScript', () => {
  it('agrees with ST_GeoHash(geometry, 6) across 200 Bangalore points', async () => {
    const points = bangalorePoints(200);

    const rows = await h.sql<{ idx: number; zone: string }[]>`
      SELECT
        ordinality - 1 AS idx,
        ST_GeoHash(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geometry, 6) AS zone
      FROM unnest(
             ${h.sql.array(points.map((p) => p.lat))}::float8[],
             ${h.sql.array(points.map((p) => p.lng))}::float8[]
           ) WITH ORDINALITY AS p(lat, lng, ordinality)
    `;

    expect(rows).toHaveLength(200);

    const disagreements = rows
      .map((row) => {
        const point = points[Number(row.idx)];
        if (point === undefined) throw new Error(`no point at index ${String(row.idx)}`);
        return { point, postgis: row.zone, typescript: zoneIdFor(point) };
      })
      .filter((r) => r.postgis !== r.typescript);

    expect(disagreements).toEqual([]);
  });

  it('agrees with the zone_id column that migration 0013 backfilled', async () => {
    const points = [
      { lat: 12.9345, lng: 77.6266 },
      { lat: 12.9716, lng: 77.5946 },
      { lat: 13.0358, lng: 77.597 },
    ];

    for (const point of points) {
      const id = await seedSpace(h, point);
      const rows = await h.sql<{ zone_id: string }[]>`
        SELECT zone_id FROM spaces WHERE id = ${id}
      `;

      expect(rows[0]?.zone_id).toBe(zoneIdFor(point));
    }
  });

  it('produces a precision-6 cell', async () => {
    const rows = await h.sql<{ zone: string }[]>`
      SELECT ST_GeoHash(ST_SetSRID(ST_MakePoint(77.6266, 12.9345), 4326)::geometry, 6) AS zone
    `;

    expect(rows[0]?.zone).toHaveLength(6);
    expect(zoneIdFor({ lat: 12.9345, lng: 77.6266 })).toHaveLength(6);
  });
});
