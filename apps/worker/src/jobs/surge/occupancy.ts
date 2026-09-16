import { ZONE_GEOHASH_PRECISION, zoneIdSchema, type ZoneId } from '@parkease/contracts/admin';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobDeps } from '../../deps.js';

/**
 * Surge zones are geohash cells. Precision 6 is ~1.22km x 0.61km, which matches
 * the intended 1-2km zone. Precision 5 is ~4.9km x 4.9km — roughly sixteen
 * times the area, which averaged a blocked street together with a half-empty
 * neighbourhood and produced no surge for either.
 *
 * Changing this re-partitions every zone and invalidates every override, so it
 * is a migration with an admin communication, not an edit. The same value is
 * produced in TypeScript by the API's zone helper, and both are standard
 * geohash over WGS84, so they agree (learnings.md verified `ST_GeoHash` against
 * a plain base32 encoder).
 */
export { ZONE_GEOHASH_PRECISION } from '@parkease/contracts/admin';

export interface ZoneOccupancy {
  readonly zoneId: ZoneId;
  /** Bookable slot-instances on active, non-deleted listings in the cell. */
  readonly totalSlots: number;
  /** Of those, the ones held over the forward window. Never exceeds totalSlots. */
  readonly occupiedSlots: number;
}

/**
 * Rows arrive from Postgres, which is outside this process, so they parse
 * rather than cast (R-VAL-01). A zone id that is not a geohash-6 cell would
 * silently never match anything the API looks up — surge that appears to work
 * and never appears.
 */
const zoneRowSchema = z
  .object({
    zone_id: zoneIdSchema,
    total_slots: z.number().int().positive(),
    occupied_slots: z.number().int().nonnegative(),
  })
  .refine((r) => r.occupied_slots <= r.total_slots, {
    message: 'A zone cannot have more slots held than it has slots',
  });

/**
 * Occupancy per zone, over a forward window from `surge_config`.
 *
 * Raw SQL, because this is PostGIS: `ST_GeoHash` has no Drizzle expression and
 * the zone id has to be computed in the database anyway, so that it is the same
 * value `spaces.zone_id` and task 7's search projection already carry
 * (.claude/rules/database.md).
 *
 * The measurement is derived from active listings only, so a zone whose only
 * space is inactive, pending approval or soft-deleted produces no row at all
 * and is skipped without a special case. Its stale Redis key expires on its own
 * inside one TTL.
 *
 * Both counts are per slot-instance, the same unit the exclusion constraint
 * works in — so "90% occupied" means nine of ten bookable slots are actually
 * held, not that nine of ten spaces have some booking.
 *
 * Two deviations from task 10 §10.5, both deliberate:
 *
 * 1. §10.5 excludes `cancelled`. This schema's slot statuses are
 *    `held | confirmed | active | released`; there is no `cancelled`. The set
 *    counted here is exactly the `booking_slots_no_overlap` exclusion
 *    constraint's own WHERE clause, which is also what `availability.service`
 *    and the search projection use — if occupancy and availability disagreed,
 *    surge would price a scarcity discovery does not show. `held` is unpaid and
 *    `released` has been given back; neither raises a zone's multiplier.
 *
 * 2. §10.5 counts occupancy as `count(bs.id)` over a LEFT JOIN. That
 *    double-counts a slot-instance holding two consecutive bookings inside the
 *    window — 10:00-11:00 and 11:00-12:00 are two rows for one slot — so a zone
 *    could report more slots held than it has, and an occupancy above 100%.
 *    `EXISTS` asks the question the measurement is actually about: is this
 *    slot-instance taken at all.
 */
export async function measureZoneOccupancy(
  deps: JobDeps,
  windowMinutes: number,
): Promise<ZoneOccupancy[]> {
  const rows = await deps.db.execute<{
    zone_id: string;
    total_slots: number;
    occupied_slots: number;
  }>(sql`
    SELECT
      ST_GeoHash(s.location::geometry, ${ZONE_GEOHASH_PRECISION}) AS zone_id,
      count(*)::int AS total_slots,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM booking_slots bs
          WHERE bs.space_id     = ss.space_id
            AND bs.vehicle_type = ss.vehicle_type
            AND bs.slot_index   = ss.slot_index
            AND bs.status IN ('confirmed', 'active')
            AND bs.period && tstzrange(
                  now(), now() + make_interval(mins => ${windowMinutes}), '[)')
        )
      )::int AS occupied_slots
    FROM spaces s
    JOIN space_slots ss ON ss.space_id = s.id
    WHERE s.approval_status = 'active'
      AND s.deleted_at IS NULL
    GROUP BY 1
  `);

  return [...rows].map((row) => {
    const parsed = zoneRowSchema.parse(row);
    return {
      zoneId: parsed.zone_id,
      totalSlots: parsed.total_slots,
      occupiedSlots: parsed.occupied_slots,
    };
  });
}
