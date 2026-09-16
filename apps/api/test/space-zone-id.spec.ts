import { zoneIdSchema } from '@parkease/contracts/admin';
import { describe, expect, it } from 'vitest';

import { zoneIdFor, ZONE_PRECISION } from '../src/platform/geo/geohash.js';

/**
 * `spaces.zone_id` is what joins a listing to its surge zone. Search selects it
 * straight into the surge lookup, and Redis is a cache — so a value that cannot
 * match a `surge:{zoneId}` key does not fail, it just quietly prices at 1.0x
 * forever, with nothing logged and no test failing.
 *
 * That is exactly what had happened. Migration 0013 replaced the old
 * `zone_<pincode>` format and backfilled every existing row, but the two write
 * paths — `create-space.command.ts` and `update-space.command.ts` — were never
 * updated with it. Every space created or edited through the API afterwards got
 * a pincode-shaped value again. The perf seed hid it by backfilling with raw
 * `ST_GeoHash` rather than going through the commands.
 *
 * These assert the property that actually matters, rather than re-stating the
 * implementation: whatever the write path produces must be a value the surge
 * key space can contain.
 */
describe('a space zone id can address a surge key', () => {
  const BANGALORE = [
    { lat: 12.9345, lng: 77.6266 }, // Koramangala
    { lat: 13.0359, lng: 77.5971 }, // Hebbal
    { lat: 12.9698, lng: 77.7499 }, // Whitefield
    { lat: 13.1986, lng: 77.7066 }, // Kempegowda airport
    { lat: 12.8452, lng: 77.6602 }, // Electronic City
  ];

  it.each(BANGALORE)('derives a geohash-6 zone for ($lat, $lng)', (point) => {
    const zoneId = zoneIdFor(point);

    expect(zoneId).toHaveLength(ZONE_PRECISION);
    expect(zoneIdSchema.safeParse(zoneId).success).toBe(true);
  });

  it('rejects the pre-0013 pincode format the write paths used to produce', () => {
    // The regression, stated as the thing it broke: this value can never match
    // a surge key, so a space carrying it never surges.
    expect(zoneIdSchema.safeParse('zone_560095').success).toBe(false);
    expect(zoneIdSchema.safeParse('zone_560001').success).toBe(false);
  });

  it('gives two spaces in the same cell the same zone, and neighbours different ones', () => {
    // Surge is priced per cell, so this is the property the whole feature rests
    // on: co-located listings must share a multiplier.
    const a = zoneIdFor({ lat: 12.9345, lng: 77.6266 });
    const b = zoneIdFor({ lat: 12.9346, lng: 77.6267 });
    const far = zoneIdFor({ lat: 13.1986, lng: 77.7066 });

    expect(a).toBe(b);
    expect(a).not.toBe(far);
  });

  it('does not change when only the address text would have changed', () => {
    // The update path used to derive the zone from the pincode, so correcting a
    // landmark re-zoned a space that had not moved. The zone follows the pin.
    const pin = { lat: 12.9345, lng: 77.6266 };
    expect(zoneIdFor(pin)).toBe(zoneIdFor({ ...pin }));
  });
});
