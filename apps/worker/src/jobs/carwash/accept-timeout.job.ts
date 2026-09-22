import {
  CARWASH_COMMISSION_RATE,
  computeWashFee,
  PARTNER_RATING_FLOOR_BP,
} from '@parkease/contracts/money';
import { toPaise } from '@parkease/contracts/primitives';
import { findWithRatingFloor, type RatingFloorFallback } from '@parkease/contracts/valet';
import {
  CARWASH_ACCEPT_TIMEOUT_JOB,
  nextCarwashStatus,
  parseCarwashJobStatus,
  WASH_ACCEPT_TIMEOUT_MS,
  WASH_OFFER_FANOUT,
  WASH_OFFER_RADII_M,
  WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS,
} from '@parkease/contracts/washer';
import {
  originFromWashJobSpace,
  washCandidateQuery,
  type WashCandidateRow,
} from '@parkease/db/queries';
import { outboxMessages, washJobOffers, washJobs } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { carwashAcceptTimeoutPayloadSchema, parseCarwashJobPayload } from './payload.js';

interface WashCandidate {
  readonly userId: string;
  readonly distanceM: number;
  readonly ratingAvgBp: number | null;
  readonly pricePaise: number;
}

/**
 * Three minutes after an offer went out with nobody taking it, widen the search.
 *
 * Radii are 3 km, then 5 km, then 8 km, and then we stop. A driver waits at
 * most nine minutes before being told plainly that nobody is available, which
 * is a better product than an indefinite spinner and a far better one than a
 * partner arriving from twenty kilometres away with a van full of equipment.
 */
export async function acceptTimeout(deps: JobDeps, raw: unknown): Promise<void> {
  const { jobId, round } = parseCarwashJobPayload(carwashAcceptTimeoutPayloadSchema, raw);

  const [job] = await deps.db.select().from(washJobs).where(eq(washJobs.id, jobId));

  /**
   * Idempotent by guard, because pg-boss delivery is at-least-once
   * (R-ASYNC-03). Three separate ways this delivery can be stale, and every one
   * of them is a normal outcome rather than an error:
   */
  if (job === undefined) {
    logger.warn({ jobId }, 'carwash accept-timeout: job no longer exists');
    return;
  }
  // Somebody accepted, or the driver cancelled, between the enqueue and now.
  if (job.status !== 'offered' && job.status !== 'requested') {
    logger.info({ jobId, status: job.status }, 'carwash accept-timeout: already resolved');
    return;
  }
  // A later round is already live; this is a redelivery of an earlier one.
  if (job.offerRound !== round) {
    logger.info(
      { jobId, deliveredRound: round, currentRound: job.offerRound },
      'carwash accept-timeout: stale round',
    );
    return;
  }

  const nextRound = round + 1;
  const nextRadiusM = WASH_OFFER_RADII_M[nextRound];

  if (nextRadiusM === undefined) {
    await giveUp(deps, job);
    return;
  }

  const candidates = await findCandidates(deps, {
    jobId: job.id,
    radiusM: nextRadiusM,
    excludeUserId: job.driverUserId,
    serviceName: job.serviceName,
    vehicleType: job.vehicleType,
  });

  const widened = await deps.db.transaction(async (tx) => {
    /**
     * `offered --offer--> offered` is a legal self-transition: the status does
     * not change, the radius and the round do. Asserting it anyway keeps the
     * widening inside the machine rather than being a status write that
     * bypasses it — which is the discipline the whole task turns on.
     */
    const to = nextCarwashStatus(parseCarwashJobStatus(job.status), 'offer');
    if (to === null) {
      throw new Error(`Car wash job ${job.id} cannot be re-offered from '${job.status}'`);
    }

    /**
     * The WHERE pins the status and the round this widening was computed from,
     * and that is not belt-and-braces over the guards above — it is the only
     * thing standing between us and overwriting an accept.
     *
     * The guards ran before `findCandidates`, which is a PostGIS query against
     * a cold index and takes real time. A partner can win
     * `AcceptWashCommand`'s conditional UPDATE inside that window: the job
     * becomes `accepted`, a partner is assigned, a price is frozen and four
     * ledger entries are posted. An UPDATE matching on `id` alone would then
     * put the row back to `offered` on top of all of that.
     *
     * Matching zero rows here is a *normal outcome*, not an error — somebody
     * got there first, which is the system working. So it returns false and is
     * logged, rather than throwing and making pg-boss retry a job that is
     * already resolved.
     */
    const updated = await tx
      .update(washJobs)
      .set({
        status: to,
        offerRadiusM: nextRadiusM,
        offerRound: nextRound,
        offeredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(washJobs.id, job.id),
          eq(washJobs.status, job.status),
          eq(washJobs.offerRound, round),
        ),
      )
      .returning({ id: washJobs.id });

    if (updated.length === 0) return false;

    if (candidates.length > 0) {
      await tx.insert(washJobOffers).values(
        candidates.map((candidate) => ({
          jobId: job.id,
          washerUserId: candidate.userId,
          distanceM: Math.round(candidate.distanceM),
          ratingAtOfferBp: candidate.ratingAvgBp,
          offerRound: nextRound,
        })),
      );
    }

    await tx.insert(outboxMessages).values([
      {
        type: CARWASH_ACCEPT_TIMEOUT_JOB,
        availableAt: new Date(Date.now() + WASH_ACCEPT_TIMEOUT_MS),
        payload: { jobId: job.id, round: nextRound },
      },
      ...candidates.map((candidate) => ({
        type: 'notification.dispatch',
        payload: {
          userId: candidate.userId,
          template: 'washer.new_job',
          data: {
            jobId: job.id,
            serviceName: job.serviceName,
            distanceM: Math.round(candidate.distanceM),
            // Each candidate's own price, from their own menu row. Three
            // partners offered one job may quote three different numbers.
            earningsPaise: computeWashFee(toPaise(candidate.pricePaise), CARWASH_COMMISSION_RATE)
              .washerEarningsPaise,
          },
        },
      })),
    ]);

    return true;
  });

  if (!widened) {
    logger.info(
      { jobId: job.id, round },
      'carwash accept-timeout: job moved on while we were searching, nothing widened',
    );
    return;
  }

  logger.info(
    { jobId: job.id, round: nextRound, radiusM: nextRadiusM, offered: candidates.length },
    'carwash accept-timeout: widened the search',
  );
}

/**
 * Out of radii. Tell the driver plainly and charge nothing.
 *
 * No ledger entries exist for this job at all: nobody was ever assigned, so
 * nobody was dispatched, so nobody is owed. The absence is the correct posting.
 */
async function giveUp(deps: JobDeps, job: typeof washJobs.$inferSelect): Promise<void> {
  const cancelled = await deps.db.transaction(async (tx) => {
    const to = nextCarwashStatus(parseCarwashJobStatus(job.status), 'cancel');
    if (to === null) {
      throw new Error(`Car wash job ${job.id} cannot be cancelled from '${job.status}'`);
    }

    /**
     * Pinned to the status we read, and this branch needs it most.
     *
     * `wash_jobs_assignee_presence_check` leaves `cancelled` unconstrained —
     * it is reachable from a state with a partner and from one without — so
     * unlike the widening above, the database would *not* catch this one. An
     * UPDATE matching on `id` alone could bury a job a partner accepted
     * milliseconds ago under `no_washer_available`, leaving their assignment,
     * their frozen price and four ledger entries standing against a job the
     * driver is told nobody took.
     *
     * Zero rows means somebody accepted while we were deciding to give up,
     * which is the best possible outcome here rather than an error.
     */
    const updated = await tx
      .update(washJobs)
      .set({
        status: to,
        cancelledAt: new Date(),
        cancellationReason: 'no_washer_available',
        updatedAt: new Date(),
      })
      .where(and(eq(washJobs.id, job.id), eq(washJobs.status, job.status)))
      .returning({ id: washJobs.id });

    if (updated.length === 0) return false;

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: job.driverUserId,
        template: 'washer.unavailable',
        data: { jobId: job.id },
      },
    });

    return true;
  });

  if (!cancelled) {
    logger.info(
      { jobId: job.id },
      'carwash accept-timeout: job was taken while we were giving up, left alone',
    );
    return;
  }

  logger.info({ jobId: job.id }, 'carwash accept-timeout: no partner available, job cancelled');
}

/**
 * The same query the API runs, from `packages/db`, under the same two-pass
 * policy from `@parkease/contracts` — neither is a second copy.
 */
async function findCandidates(
  deps: JobDeps,
  input: {
    jobId: string;
    radiusM: number;
    excludeUserId: string;
    serviceName: string;
    vehicleType: string;
  },
): Promise<WashCandidate[]> {
  return findWithRatingFloor(
    async (minRatingBp: number | null) => {
      const rows = await deps.db.execute<WashCandidateRow>(
        washCandidateQuery({
          origin: originFromWashJobSpace(input.jobId),
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
      }));
    },
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
