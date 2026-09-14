import { describe, expect, it } from 'vitest';

import { ZONE_PRECISION, geohashEncode, zoneIdFor } from '../src/platform/geo/geohash.js';

/**
 * Reference vectors from the geohash specification. These are the same values
 * PostGIS ST_GeoHash produces, which is the property the integration test in
 * test/integration/geohash-agreement.integration.test.ts asserts at scale.
 */
describe('geohashEncode', () => {
  it.each([
    [57.64911, 10.40744, 11, 'u4pruydqqvj'],
    [-25.382708, -49.265506, 9, '6gkzwgjzn'],
    [0, 0, 6, 's00000'],
    // Koramangala. Verified by decoding the cell back: its bounding box
    // (12.9309..12.9364, 77.6184..77.6294) contains the point.
    [12.9345, 77.6266, 6, 'tdr1w6'],
  ])('encodes (%s, %s) at precision %s', (lat, lng, precision, expected) => {
    expect(geohashEncode(lat, lng, precision)).toBe(expected);
  });

  it('is a prefix code — a shorter hash is a prefix of a longer one', () => {
    const long = geohashEncode(12.9345, 77.6266, 9);
    expect(long.startsWith(geohashEncode(12.9345, 77.6266, 6))).toBe(true);
  });

  it('gives two points in the same ~1.2km cell the same hash', () => {
    expect(geohashEncode(12.9345, 77.6266, 6)).toBe(geohashEncode(12.9347, 77.6268, 6));
  });

  it('gives distant points different hashes', () => {
    expect(geohashEncode(12.9345, 77.6266, 6)).not.toBe(geohashEncode(19.076, 72.8777, 6));
  });

  it.each([
    ['the poles', 90, 0],
    ['the antimeridian', 0, 180],
    ['the negative antimeridian', 0, -180],
  ])('encodes %s without throwing', (_label, lat, lng) => {
    expect(geohashEncode(lat, lng, 6)).toHaveLength(6);
  });

  it('produces a hash of exactly the requested precision', () => {
    for (let p = 1; p <= 12; p += 1) {
      expect(geohashEncode(12.9345, 77.6266, p)).toHaveLength(p);
    }
  });

  it('rejects a non-finite coordinate rather than emitting a garbage zone', () => {
    expect(() => geohashEncode(Number.NaN, 77.6266, 6)).toThrow();
  });

  it('rejects an out-of-range latitude', () => {
    expect(() => geohashEncode(91, 0, 6)).toThrow();
  });
});

describe('zoneIdFor', () => {
  it('uses the documented zone precision', () => {
    expect(ZONE_PRECISION).toBe(6);
    expect(zoneIdFor({ lat: 12.9345, lng: 77.6266 })).toHaveLength(6);
  });

  it('matches geohashEncode at the zone precision', () => {
    const point = { lat: 12.9345, lng: 77.6266 };
    expect(zoneIdFor(point)).toBe(geohashEncode(point.lat, point.lng, ZONE_PRECISION));
  });
});
