import { Inject, Injectable } from '@nestjs/common';
import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import { type SQL, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import { logger } from '../../platform/observability/logger.js';

import type { OfferCandidate } from './valet.service.js';

/** §11.5. Two minutes a round, so a driver waits at most six before being told. */
export const OFFER_RADII_M = [5_000, 8_000, 12_000] as const;

/**
 * The offer goes to the nearest five, all at once. Sequential offers with a
 * per-valet timeout would multiply the driver's wait by the number of valets who
 * ignore their phone.
 */
export const OFFER_FANOUT = 5;

/**
 * `is_online` is what the valet last chose; this is what makes it mean
 * *reachable*. A phone that lost connectivity still has `is_online = true`, and
 * offering a job to a handset that cannot ring is how a driver waits two minutes
 * for nothing.
 */
const ONLINE_HEARTBEAT_WINDOW_SECONDS = 90;

export interface FindCandidatesInput {
  /** A geography expression, never a JS `{ lng, lat }`. See `originFrom*`. */
  readonly origin: SQL;
  readonly radiusM: number;
  readonly excludeUserId: string;
  /** Excludes valets already offered this job. `null` when no job exists yet. */
  readonly jobId: string | null;
}

/**
 * The origin for a *new* request, from the numbers in the request body.
 *
 * Safe to build in JS because these arrived as JSON and were parsed by Zod —
 * they were never a PostGIS value. A path that already has a stored point must
 * use `originFromJobPickup` instead.
 */
export const originFromPoint = (lat: number, lng: number): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

/**
 * The origin for a re-offer, read from the column and never through JavaScript.
 *
 * This is the v1 bug made structurally unreachable. v1 read
 * `job.pickupLocation.lng` off a geography column, which a raw driver read
 * returns as WKB hex — so `.lng` was `undefined` and every widened search ran
 * from `POINT(undefined undefined)`, i.e. nowhere. Keeping the value inside SQL
 * means there is no point at which it can be destructured wrongly
 * (ADR-004, R-DB-07).
 */
export const originFromJobPickup = (jobId: string): SQL =>
  sql`(SELECT vj.pickup_location FROM valet_jobs vj WHERE vj.id = ${jobId})`;

type ValetCandidateRow = {
  user_id: string;
  rating_avg_bp: number | null;
  distance_m: number;
};

@Injectable()
export class AssignmentService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Verified, reachable valets inside `radiusM`, nearest first, capped at five.
   *
   * Two passes, not one query with an OR. The floor has to be able to *fail
   * visibly*: a single query that silently accepted anyone when the filtered set
   * came back empty would be indistinguishable from having no floor at all,
   * which is how v1 shipped a rating rule that existed only in prose.
   */
  async findCandidates(input: FindCandidatesInput): Promise<OfferCandidate[]> {
    const aboveFloor = await this.query(input, true);
    if (aboveFloor.length > 0) return aboveFloor;

    const anyRating = await this.query(input, false);
    if (anyRating.length === 0) return [];

    /**
     * A driver with a paid booking and no car in the bay is a worse outcome than
     * a low-rated valet. The fallback is logged as an operational event so the
     * ops dashboard can see how often supply forces our hand — if this is
     * frequent in a zone, the answer is recruitment, not a lower floor.
     */
    logger.warn(
      {
        jobId: input.jobId,
        radiusM: input.radiusM,
        ratingFloorBp: PARTNER_RATING_FLOOR_BP,
        fallbackCandidates: anyRating.length,
        lowestRatingBp: anyRating.reduce<number | null>(
          (lowest, c) =>
            c.ratingAvgBp === null ? lowest : Math.min(lowest ?? c.ratingAvgBp, c.ratingAvgBp),
          null,
        ),
      },
      'valet assignment fell back below the rating floor',
    );

    return anyRating;
  }

  /**
   * Six filters beyond distance, each of which is a rule somebody would
   * otherwise have to remember: the `valet` role is active, the user account is
   * active, verification passed, the licence has not expired, the valet is not
   * already on a live job, and they have not already been offered this one.
   *
   * Distance is computed by PostGIS on the geography type, in metres on the
   * spheroid, and ordered on the exact value rather than a rounded one.
   */
  private async query(
    input: FindCandidatesInput,
    applyRatingFloor: boolean,
  ): Promise<OfferCandidate[]> {
    /**
     * An unrated partner clears the floor in the *first* pass, not the logged
     * fallback: a new valet cannot be starved of the jobs that would rate them
     * (task 17), and their presence is not a supply problem worth warning about.
     */
    const ratingFilter = applyRatingFloor
      ? sql`AND (vp.rating_count = 0 OR vp.rating_avg_bp >= ${PARTNER_RATING_FLOOR_BP})`
      : sql``;

    // No offers exist on a first dispatch, so the anti-join has nothing to
    // exclude and is omitted rather than run against a null id.
    const alreadyOffered =
      input.jobId === null
        ? sql``
        : sql`AND NOT EXISTS (
            SELECT 1 FROM valet_job_offers vo
            WHERE vo.job_id = ${input.jobId} AND vo.valet_user_id = vp.user_id
          )`;

    const rows = await this.db.execute<ValetCandidateRow>(sql`
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
        AND vp.last_seen_at > now() - make_interval(secs => ${ONLINE_HEARTBEAT_WINDOW_SECONDS})
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
      LIMIT ${OFFER_FANOUT}
    `);

    return rows.map((row) => ({
      userId: row.user_id,
      distanceM: Number(row.distance_m),
      ratingAvgBp: row.rating_avg_bp === null ? null : Number(row.rating_avg_bp),
    }));
  }
}
