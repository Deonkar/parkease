import { Inject, Injectable } from '@nestjs/common';
import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import { OFFER_FANOUT, ONLINE_HEARTBEAT_WINDOW_SECONDS } from '@parkease/contracts/valet';
import {
  originFromJobPickup,
  originFromPoint,
  valetCandidateQuery,
  type ValetCandidateRow,
} from '@parkease/db/queries';
import type { SQL } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import { logger } from '../../platform/observability/logger.js';

import type { OfferCandidate } from './valet.service.js';

export interface FindCandidatesInput {
  /** A geography expression, never a JS `{ lng, lat }`. See `originFrom*`. */
  readonly origin: SQL;
  readonly radiusM: number;
  readonly excludeUserId: string;
  /** Excludes valets already offered this job. `null` when no job exists yet. */
  readonly jobId: string | null;
}

/**
 * Re-exported so callers in this domain have one import, and so the fact that
 * the worker runs the same query is visible from here. The radius ladder, the
 * fan-out and the heartbeat window all come from `@parkease/contracts/valet`
 * for the same reason.
 */
export { originFromJobPickup, originFromPoint };
export { OFFER_FANOUT, OFFER_RADII_M } from '@parkease/contracts/valet';

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
   *
   * The cost is explicit: when the floored pass returns nothing this is
   * **O(2 x scan)**, not O(1) — the full radius search with all six filters runs
   * a second time, and it does so at exactly the moment latency matters most,
   * with a driver already waiting. That is the accepted trade. Collapsing it to
   * one query would mean losing the ability to tell "nobody clears the floor"
   * from "nobody is here", which is the distinction the warning log exists to
   * report and the one ops needs to decide between recruiting and relaxing.
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
    const rows = await this.db.execute<ValetCandidateRow>(
      valetCandidateQuery({
        origin: input.origin,
        radiusM: input.radiusM,
        excludeUserId: input.excludeUserId,
        jobId: input.jobId,
        minRatingBp: applyRatingFloor ? PARTNER_RATING_FLOOR_BP : null,
        limit: OFFER_FANOUT,
        heartbeatWindowSeconds: ONLINE_HEARTBEAT_WINDOW_SECONDS,
      }),
    );

    return rows.map((row) => ({
      userId: row.user_id,
      distanceM: Number(row.distance_m),
      ratingAvgBp: row.rating_avg_bp === null ? null : Number(row.rating_avg_bp),
    }));
  }
}
