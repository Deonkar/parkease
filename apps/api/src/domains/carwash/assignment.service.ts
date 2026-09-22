import { Inject, Injectable } from '@nestjs/common';
import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import { PARTNER_RATING_FLOOR_BP } from '@parkease/contracts/money';
import { findWithRatingFloor, type RatingFloorFallback } from '@parkease/contracts/valet';
import {
  WASH_OFFER_FANOUT,
  WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS,
} from '@parkease/contracts/washer';
import { washCandidateQuery, type WashCandidateRow } from '@parkease/db/queries';
import type { SQL } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import { logger } from '../../platform/observability/logger.js';

import type { WashOfferCandidate } from './carwash.service.js';

export interface FindWashCandidatesInput {
  /** A geography expression, never a JS `{ lng, lat }`. See `originFrom*`. */
  readonly origin: SQL;
  readonly radiusM: number;
  readonly excludeUserId: string;
  /** Excludes partners already offered this job. `null` when no job exists yet. */
  readonly jobId: string | null;
  readonly serviceName: CarwashServiceName;
  readonly vehicleType: VehicleType;
}

@Injectable()
export class WashAssignmentService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Verified, reachable partners inside `radiusM` who price this service for
   * this vehicle type, nearest first, capped at three.
   *
   * The two-pass rating floor is `findWithRatingFloor` from contracts — the
   * same helper the valet side uses and the worker reuses on every widened
   * round. Not a second implementation: that file's own docstring records that
   * it was briefly hand-written in both places, which is the textbook second
   * use (R-ARCH-07), and that a change to the fallback would otherwise apply to
   * one round and not the others with nothing failing.
   *
   * The floor has to be able to *fail visibly*. A single query that silently
   * accepted anyone when the filtered set came back empty would be
   * indistinguishable from having no floor at all, which is how v1 shipped a
   * rating rule that existed only in prose. The cost is explicit: when the
   * floored pass returns nothing this is **O(2 x scan)**, paid at the moment
   * latency matters most, with a driver already waiting. That is the accepted
   * trade — collapsing it would lose the ability to tell "nobody clears the
   * floor" from "nobody is here", and that distinction is what ops needs to
   * decide between recruiting and relaxing.
   */
  async findCandidates(input: FindWashCandidatesInput): Promise<WashOfferCandidate[]> {
    return findWithRatingFloor(
      (minRatingBp: number | null) => this.query(input, minRatingBp),
      (fallback: RatingFloorFallback) => {
        logger.warn(
          {
            jobId: input.jobId,
            radiusM: input.radiusM,
            serviceName: input.serviceName,
            vehicleType: input.vehicleType,
            ratingFloorBp: PARTNER_RATING_FLOOR_BP,
            ...fallback,
          },
          'wash assignment fell back below the rating floor',
        );
      },
    );
  }

  /**
   * Six filters beyond distance, each of which is a rule somebody would
   * otherwise have to remember: the `washer` role is active, the user account
   * is active, verification passed, the partner is not already on a live job,
   * they have not already been offered this one — and they actually price this
   * service for this vehicle type, which is the one the valet query has no
   * equivalent of.
   *
   * The price comes back with the candidate because the push notification
   * quotes the partner's own earnings, and in a fan-out of three each partner
   * may be quoting a different number from their own menu.
   */
  private async query(
    input: FindWashCandidatesInput,
    minRatingBp: number | null,
  ): Promise<WashOfferCandidate[]> {
    const rows = await this.db.execute<WashCandidateRow>(
      washCandidateQuery({
        origin: input.origin,
        radiusM: input.radiusM,
        excludeUserId: input.excludeUserId,
        jobId: input.jobId,
        serviceName: input.serviceName,
        vehicleType: input.vehicleType,
        minRatingBp,
        limit: WASH_OFFER_FANOUT,
        heartbeatWindowSeconds: WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS,
      }),
    );

    return rows.map((row) => ({
      userId: row.user_id,
      distanceM: Number(row.distance_m),
      ratingAvgBp: row.rating_avg_bp === null ? null : Number(row.rating_avg_bp),
      pricePaise: Number(row.price_paise),
      durationMinutes: Number(row.duration_minutes),
    }));
  }
}
