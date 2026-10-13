import {
  computeValetLegFee,
  PARTNER_RATING_FLOOR_BP,
  VALET_COMMISSION_RATE,
} from '@parkease/contracts/money';
import {
  ACCEPT_TIMEOUT_MS,
  findWithRatingFloor,
  nextValetStatus,
  OFFER_FANOUT,
  OFFER_RADII_M,
  ONLINE_HEARTBEAT_WINDOW_SECONDS,
  parseValetJobStatus,
  type RatingFloorFallback,
  VALET_ACCEPT_TIMEOUT_JOB,
} from '@parkease/contracts/valet';
import {
  originFromJobPickup,
  valetCandidateQuery,
  type ValetCandidateRow,
} from '@parkease/db/queries';
import { outboxMessages, valetJobOffers, valetJobs } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { acceptTimeoutPayloadSchema, parseValetJobPayload } from './payload.js';

/**
 * Two minutes after an offer went out with nobody taking it, widen the search.
 *
 * Radii are 5 km, then 8 km, then 12 km, and then we stop. A driver waits at
 * most six minutes before being told plainly that nobody is available, which is
 * a better product than an indefinite spinner and a far better one than a valet
 * arriving from thirty kilometres away.
 */
export async function acceptTimeout(deps: JobDeps, raw: unknown): Promise<void> {
  const { jobId, round } = parseValetJobPayload(acceptTimeoutPayloadSchema, raw);

  const [job] = await deps.db.select().from(valetJobs).where(eq(valetJobs.id, jobId));

  /**
   * Idempotent by guard, because pg-boss delivery is at-least-once
   * (R-ASYNC-03). Three separate ways this delivery can be stale, and every one
   * of them is a normal outcome rather than an error:
   */
  if (job === undefined) {
    logger.warn({ jobId }, 'valet accept-timeout: job no longer exists');
    return;
  }
  // Somebody accepted, or the driver cancelled, between the enqueue and now.
  if (job.status !== 'offered' && job.status !== 'requested') {
    logger.info({ jobId, status: job.status }, 'valet accept-timeout: already resolved');
    return;
  }
  // A later round is already live; this is a redelivery of an earlier one.
  if (job.offerRound !== round) {
    logger.info(
      { jobId, deliveredRound: round, currentRound: job.offerRound },
      'valet accept-timeout: stale round',
    );
    return;
  }

  const nextRound = round + 1;
  const nextRadiusM = OFFER_RADII_M[nextRound];

  if (nextRadiusM === undefined) {
    await giveUp(deps, job);
    return;
  }

  const candidates = await findCandidates(deps, {
    jobId: job.id,
    radiusM: nextRadiusM,
    excludeUserId: job.driverUserId,
  });

  const widened = await deps.db.transaction(async (tx) => {
    /**
     * `offered --offer--> offered` is a legal self-transition: the status does
     * not change, the radius and the round do. Asserting it anyway keeps the
     * widening inside the machine rather than being a status write that bypasses
     * it — which is the discipline the whole task turns on.
     */
    const to = nextValetStatus(parseValetJobStatus(job.status), 'offer');
    if (to === null) {
      throw new Error(`Valet job ${job.id} cannot be re-offered from '${job.status}'`);
    }

    /**
     * The WHERE pins the status and the round this widening was computed from (S-18). The guards
     * above ran before `findCandidates`, a PostGIS query that takes real time, and a valet can win
     * `AcceptJobCommand`'s conditional UPDATE inside that window: assignee, fee, `txn_id` and four
     * ledger entries committed. Matching on `id` alone would put the row back to `offered` on top of
     * all of that. Zero rows is the normal "somebody got there first", not an error.
     */
    const updated = await tx
      .update(valetJobs)
      .set({
        status: to,
        offerRadiusM: nextRadiusM,
        offerRound: nextRound,
        offeredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(valetJobs.id, job.id),
          eq(valetJobs.status, job.status),
          eq(valetJobs.offerRound, round),
        ),
      )
      .returning({ id: valetJobs.id });
    if (updated.length === 0) return false;

    if (candidates.length > 0) {
      await tx.insert(valetJobOffers).values(
        candidates.map((candidate) => ({
          jobId: job.id,
          valetUserId: candidate.userId,
          distanceM: Math.round(candidate.distanceM),
          ratingAtOfferBp: candidate.ratingAvgBp,
          offerRound: nextRound,
        })),
      );
    }

    await tx.insert(outboxMessages).values([
      {
        type: VALET_ACCEPT_TIMEOUT_JOB,
        availableAt: new Date(Date.now() + ACCEPT_TIMEOUT_MS),
        payload: { jobId: job.id, round: nextRound },
      },
      ...candidates.map((candidate) => ({
        type: 'notification.dispatch',
        payload: {
          userId: candidate.userId,
          template: 'valet.new_job',
          data: {
            jobId: job.id,
            distanceM: Math.round(candidate.distanceM),
            earningsPaise: computeValetLegFee(candidate.distanceM, VALET_COMMISSION_RATE)
              .valetEarningsPaise,
          },
        },
      })),
    ]);
    return true;
  });

  if (!widened) {
    logger.info(
      { jobId: job.id, round },
      'valet accept-timeout: job moved on while we were searching, nothing widened',
    );
    return;
  }

  logger.info(
    { jobId: job.id, round: nextRound, radiusM: nextRadiusM, offered: candidates.length },
    'valet accept-timeout: widened the search',
  );
}

/**
 * Out of radii. Tell the driver plainly and charge nothing.
 *
 * No ledger entries exist for this job at all: nobody was ever assigned, so
 * nobody was dispatched, so nobody is owed. The absence is the correct posting.
 */
async function giveUp(deps: JobDeps, job: typeof valetJobs.$inferSelect): Promise<void> {
  const cancelled = await deps.db.transaction(async (tx) => {
    const to = nextValetStatus(parseValetJobStatus(job.status), 'cancel');
    if (to === null) {
      throw new Error(`Valet job ${job.id} cannot be cancelled from '${job.status}'`);
    }

    // Pinned like the widening (S-18). `cancelled` is unconstrained by the assignee CHECK, so a
    // blind write here would bury a job a valet had just accepted, ledger and all.
    const updated = await tx
      .update(valetJobs)
      .set({
        status: to,
        cancelledAt: new Date(),
        cancellationReason: 'no_valet_available',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(valetJobs.id, job.id),
          eq(valetJobs.status, job.status),
          eq(valetJobs.offerRound, job.offerRound),
        ),
      )
      .returning({ id: valetJobs.id });
    if (updated.length === 0) return false;

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: job.driverUserId,
        template: 'valet.unavailable',
        data: { jobId: job.id },
      },
    });
    return true;
  });

  if (!cancelled) {
    logger.info(
      { jobId: job.id },
      'valet accept-timeout: job was taken while we were giving up, left alone',
    );
    return;
  }
  logger.info({ jobId: job.id }, 'valet accept-timeout: no valet available, job cancelled');
}

/**
 * The same query the API runs, from `packages/db`, under the same two-pass
 * policy from `@parkease/contracts` — neither is a second copy.
 */
async function findCandidates(
  deps: JobDeps,
  input: { jobId: string; radiusM: number; excludeUserId: string },
): Promise<{ userId: string; distanceM: number; ratingAvgBp: number | null }[]> {
  return findWithRatingFloor(
    async (minRatingBp: number | null) => {
      const rows = await deps.db.execute<ValetCandidateRow>(
        valetCandidateQuery({
          origin: originFromJobPickup(input.jobId),
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
    },
    (fallback: RatingFloorFallback) => {
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
