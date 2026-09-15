/**
 * Geohash encoding, matching PostGIS `ST_GeoHash(geometry, precision)`.
 *
 * Surge zones are geohash cells: the search query reads `spaces.zone_id`, the
 * worker writes `surge:{zoneId}` to Redis, and both must name the same cell for
 * the same point. `test/integration/geohash-agreement.integration.test.ts`
 * asserts this implementation agrees with ST_GeoHash across a Bangalore fixture
 * set — a silent disagreement would mean "no surge, ever".
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BITS_PER_CHAR = 5;

/** Precision 6 is a ~1.2km x 0.6km cell — the surge zone granularity. */
export const ZONE_PRECISION = 6;

export interface GeoPointInput {
  readonly lat: number;
  readonly lng: number;
}

export function geohashEncode(lat: number, lng: number, precision: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RangeError(
      `geohash: coordinates must be finite, got (${String(lat)}, ${String(lng)})`,
    );
  }
  if (lat < -90 || lat > 90) {
    throw new RangeError(`geohash: latitude out of range: ${String(lat)}`);
  }
  if (lng < -180 || lng > 180) {
    throw new RangeError(`geohash: longitude out of range: ${String(lng)}`);
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    throw new RangeError(
      `geohash: precision must be an integer in 1..12, got ${String(precision)}`,
    );
  }

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let hash = '';
  let bits = 0;
  let charIndex = 0;
  // Longitude and latitude bits interleave, longitude first.
  let isLongitudeBit = true;

  while (hash.length < precision) {
    if (isLongitudeBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        charIndex = charIndex * 2 + 1;
        lngMin = mid;
      } else {
        charIndex *= 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        charIndex = charIndex * 2 + 1;
        latMin = mid;
      } else {
        charIndex *= 2;
        latMax = mid;
      }
    }

    isLongitudeBit = !isLongitudeBit;
    bits += 1;

    if (bits === BITS_PER_CHAR) {
      // charAt over BASE32[i]: charIndex is 0..31 by construction, and charAt is
      // typed `string` where the index signature is `string | undefined`.
      hash += BASE32.charAt(charIndex);
      bits = 0;
      charIndex = 0;
    }
  }

  return hash;
}

/** The surge zone a point belongs to. */
export function zoneIdFor(point: GeoPointInput): string {
  return geohashEncode(point.lat, point.lng, ZONE_PRECISION);
}
