import { Inject, Injectable } from '@nestjs/common';
import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import {
  findWithRatingFloor,
  OFFER_FANOUT,
  ONLINE_HEARTBEAT_WINDOW_SECONDS,
  type RatingFloorFallback,
} from '@parkease/contracts/valet';
import { valetCandidateQuery, type ValetCandidateRow } from '@parkease/db/queries';
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
    return findWithRatingFloor(
      (minRatingBp: number | null) => this.query(input, minRatingBp),
      (fallback: RatingFloorFallback) => {
        /**
         * A driver with a paid booking and no car in the bay is a worse outcome
         * than a low-rated valet. Logged as an operational event so the ops
         * dashboard can see how often supply forces our hand — if this is
         * frequent in a zone, the answer is recruitment, not a lower floor.
         */
        logger.warn(
          {
            jobId: input.jobId,
            radiusM: input.radiusM,
            ratingFloorBp: PARTNER_RATING_FLOOR_BP,
            ...fallback,
          },
          'valet assignment fell back below the rating floor',
        );
      },
    );
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
    minRatingBp: number | null,
  ): Promise<OfferCandidate[]> {
    const rows = await this.db.execute<ValetCandidateRow>(
      valetCandidateQuery({
        origin: input.origin,
        radiusM: input.radiusM,
        excludeUserId: input.excludeUserId,
        jobId: input.jobId,
        minRatingBp,
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
