import { type SQL, sql } from 'drizzle-orm';

/**
 * The origin for a job that already exists, read from the column and never
 * through JavaScript.
 *
 * A geography column does not hand a raw driver read a `{ lng, lat }` — it
 * comes back as WKB hex, so `.lng` is `undefined` and every widened search
 * would run from `POINT(undefined undefined)`, i.e. nowhere off the coast of
 * Africa. That is the v1 valet bug, recorded in `originFromJobPickup`'s own
 * docstring. Keeping the point inside SQL is what makes it unreachable rather
 * than merely fixed (ADR-004, R-DB-07).
 */
export const originFromWashJobSpace = (jobId: string): SQL =>
  sql`(SELECT wj.space_location FROM wash_jobs wj WHERE wj.id = ${jobId})`;

export interface WashCandidateQueryInput {
  /** A geography expression. `originFromWashJobSpace`, or `originFromPoint`. */
  readonly origin: SQL;
  readonly radiusM: number;
  readonly excludeUserId: string;
  /** Excludes partners already offered this job. `null` before a job exists. */
  readonly jobId: string | null;
  /** The service being requested. A partner who does not price it is not eligible. */
  readonly serviceName: string;
  readonly vehicleType: string;
  /** The floor in basis points, or `null` for the documented fallback pass. */
  readonly minRatingBp: number | null;
  readonly limit: number;
  readonly heartbeatWindowSeconds: number;
}

export type WashCandidateRow = {
  user_id: string;
  rating_avg_bp: number | null;
  distance_m: number;
  price_paise: number;
  duration_minutes: number;
};

/**
 * Who may be offered a car wash right now, nearest first.
 *
 * This lives in `packages/db` rather than in either deployable because both run
 * it: the API dispatches the first round, and the worker widens the radius
 * three minutes later. A second copy would be a second place for the filters to
 * drift, and the drift would not be loud — it would mean a widened round
 * offering a job to a partner the first round correctly excluded.
 *
 * Six filters beyond distance: the `washer` role is active, the user account is
 * active, verification passed, the partner is not already on a live job, they
 * have not already been offered this one, and — the one this query has that the
 * valet's does not — **they actually price this service for this vehicle type**.
 * A partner who does not do Full Detailing for bikes cannot be offered a Full
 * Detailing job for a bike, and an inactive menu row is the same as no row.
 *
 * `is_online` alone is not enough. A phone that lost connectivity still has it
 * set, so the `last_seen_at` heartbeat is what actually means *reachable*.
 *
 * The price comes back with the candidate because the notification quotes the
 * partner's own earnings, and their earnings depend on their own menu — each
 * candidate in a fan-out of three may be quoting a different number.
 *
 * Distance is computed by PostGIS on the geography type, in metres on the
 * spheroid, and ordered on the exact value rather than a rounded one.
 */
export function washCandidateQuery(input: WashCandidateQueryInput): SQL {
  /**
   * An unrated partner clears the floor rather than falling to the fallback
   * pass: a new partner cannot be starved of the jobs that would rate them
   * (task 17), and their presence is not a supply problem worth warning about.
   */
  const ratingFilter =
    input.minRatingBp === null
      ? sql``
      : sql`AND (wp.rating_count = 0 OR wp.rating_avg_bp >= ${input.minRatingBp})`;

  // No offers exist on a first dispatch, so the anti-join has nothing to
  // exclude and is omitted rather than run against a null id.
  const alreadyOffered =
    input.jobId === null
      ? sql``
      : sql`AND NOT EXISTS (
          SELECT 1 FROM wash_job_offers wo
          WHERE wo.job_id = ${input.jobId} AND wo.washer_user_id = wp.user_id
        )`;

  return sql`
    SELECT wp.user_id,
           wp.rating_avg_bp,
           ST_Distance(wp.current_location, ${input.origin}) AS distance_m,
           ws.price_paise,
           ws.duration_minutes
    FROM washer_profiles wp
    JOIN user_roles ur
      ON ur.user_id = wp.user_id AND ur.role = 'washer' AND ur.status = 'active'
    JOIN users u
      ON u.id = wp.user_id AND u.status = 'active'
    JOIN wash_services ws
      ON ws.washer_user_id = wp.user_id
     AND ws.service_name = ${input.serviceName}
     AND ws.vehicle_type = ${input.vehicleType}
     AND ws.is_active = true
    WHERE wp.verification_status = 'verified'
      AND wp.is_online = true
      AND wp.last_seen_at > now() - make_interval(secs => ${input.heartbeatWindowSeconds})
      AND wp.current_location IS NOT NULL
      AND ST_DWithin(wp.current_location, ${input.origin}, ${input.radiusM})
      AND wp.user_id <> ${input.excludeUserId}
      AND NOT EXISTS (
        SELECT 1 FROM wash_jobs wj
        WHERE wj.washer_user_id = wp.user_id
          AND wj.status NOT IN ('completed', 'cancelled')
      )
      ${alreadyOffered}
      ${ratingFilter}
    ORDER BY distance_m
    LIMIT ${input.limit}
  `;
}
