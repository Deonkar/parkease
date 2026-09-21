import { type SQL, sql } from 'drizzle-orm';

/**
 * The origin for an offer that already has a job, read from the column and
 * never through JavaScript.
 *
 * v1 did `job.pickupLocation.lng` on a geography column, which a raw driver read
 * returns as WKB hex — `.lng` was `undefined`, so every widened search ran from
 * `POINT(undefined undefined)`, i.e. nowhere off the coast of Africa. Keeping
 * the point inside SQL is what makes that unreachable rather than merely fixed
 * (ADR-004, R-DB-07).
 */
export const originFromJobPickup = (jobId: string): SQL =>
  sql`(SELECT vj.pickup_location FROM valet_jobs vj WHERE vj.id = ${jobId})`;

/**
 * The origin for a brand-new request, from the numbers in the request body.
 *
 * Safe to build in JS because these arrived as JSON and were parsed by Zod. They
 * were never a PostGIS value, which is the distinction that matters.
 */
export const originFromPoint = (lat: number, lng: number): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

export interface ValetCandidateQueryInput {
  /** A geography expression. Use one of the `originFrom*` builders. */
  readonly origin: SQL;
  readonly radiusM: number;
  readonly excludeUserId: string;
  /** Excludes valets already offered this job. `null` before a job exists. */
  readonly jobId: string | null;
  /** The floor in basis points, or `null` for the documented fallback pass. */
  readonly minRatingBp: number | null;
  readonly limit: number;
  readonly heartbeatWindowSeconds: number;
}

export type ValetCandidateRow = {
  user_id: string;
  rating_avg_bp: number | null;
  distance_m: number;
};

/**
 * Who may be offered a valet job right now, nearest first.
 *
 * This lives in `packages/db` rather than in either deployable because both run
 * it: the API dispatches the first round, and the worker widens the radius two
 * minutes later. A second copy would be a second place for the filters to drift,
 * and the drift would not be loud — it would mean a widened round offering a job
 * to a partner the first round correctly excluded. `learnings.md` is explicit
 * that the only real answer here is single-sourcing.
 *
 * Six filters beyond distance, each of which is a rule somebody would otherwise
 * have to remember: the `valet` role is active, the user account is active,
 * verification passed, the licence has not expired, the valet is not already on
 * a live job, and they have not already been offered this one.
 *
 * `is_online` alone is not enough. A phone that lost connectivity still has it
 * set, so the `last_seen_at` heartbeat is what actually means *reachable*.
 *
 * Distance is computed by PostGIS on the geography type, in metres on the
 * spheroid, and ordered on the exact value rather than a rounded one.
 */
export function valetCandidateQuery(input: ValetCandidateQueryInput): SQL {
  /**
   * An unrated partner clears the floor rather than falling to the fallback
   * pass: a new valet cannot be starved of the jobs that would rate them
   * (task 17), and their presence is not a supply problem worth warning about.
   */
  const ratingFilter =
    input.minRatingBp === null
      ? sql``
      : sql`AND (vp.rating_count = 0 OR vp.rating_avg_bp >= ${input.minRatingBp})`;

  // No offers exist on a first dispatch, so the anti-join has nothing to
  // exclude and is omitted rather than run against a null id.
  const alreadyOffered =
    input.jobId === null
      ? sql``
      : sql`AND NOT EXISTS (
          SELECT 1 FROM valet_job_offers vo
          WHERE vo.job_id = ${input.jobId} AND vo.valet_user_id = vp.user_id
        )`;

  return sql`
    SELECT vp.user_id,
           vp.rating_avg_bp,
           ST_Distance(vp.current_location, ${input.origin}) AS distance_m
    FROM valet_profiles vp
    JOIN user_roles ur
      ON ur.user_id = vp.user_id AND ur.role = 'valet' AND ur.status = 'active'
    JOIN users u
      ON u.id = vp.user_id AND u.status = 'active'
    WHERE vp.verification_status = 'verified'
      AND vp.is_online = true
      AND vp.last_seen_at > now() - make_interval(secs => ${input.heartbeatWindowSeconds})
      AND vp.current_location IS NOT NULL
      AND (vp.licence_expires_at IS NULL OR vp.licence_expires_at > now())
      AND ST_DWithin(vp.current_location, ${input.origin}, ${input.radiusM})
      AND vp.user_id <> ${input.excludeUserId}
      AND NOT EXISTS (
        SELECT 1 FROM valet_jobs vj
        WHERE vj.assigned_user_id = vp.user_id
          AND vj.status NOT IN ('completed', 'cancelled', 'no_show')
      )
      ${alreadyOffered}
      ${ratingFilter}
    ORDER BY distance_m
    LIMIT ${input.limit}
  `;
}
