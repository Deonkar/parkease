import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeValetLegFee, VALET_COMMISSION_RATE } from '@parkease/contracts/money';
import {
  ACCEPT_TIMEOUT_MS,
  OFFER_RADII_M,
  VALET_ACCEPT_TIMEOUT_JOB,
} from '@parkease/contracts/valet';
import { originFromPoint } from '@parkease/db/queries';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { AssignmentService } from '../assignment.service.js';
import { type OfferCandidate, type ValetJobRow, ValetService } from '../valet.service.js';

export interface RequestValetInput {
  readonly driverId: string;
  readonly bookingId: string;
  readonly pickup: { readonly lat: number; readonly lng: number; readonly address: string };
}

export interface RequestValetResult {
  readonly job: ValetJobRow;
  readonly offeredTo: number;
}

@Injectable()
export class RequestValetCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly valet: ValetService,
    private readonly assignment: AssignmentService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: RequestValetInput): Promise<RequestValetResult> {
    const booking = await this.valet.findOwnedBooking(input.bookingId, input.driverId);
    if (booking === undefined) throw new NotFoundException();
    this.valet.assertBookingIsValetEligible(booking.status);
    await this.valet.assertNoLiveJobForBooking(booking.id);

    const radiusM = OFFER_RADII_M[0];

    /**
     * The candidate search runs *before* the transaction opens. It is a read, it
     * can be slow on a cold GiST index, and holding a write transaction open
     * across it would put every concurrent valet request behind it (R-BE-04).
     */
    const candidates = await this.assignment.findCandidates({
      origin: originFromPoint(input.pickup.lat, input.pickup.lng),
      radiusM,
      excludeUserId: input.driverId,
      jobId: null,
    });

    return withTransaction(this.db, async (tx) => {
      const job = await this.valet.insert(tx, {
        bookingId: booking.id,
        driverUserId: input.driverId,
        pickup: input.pickup,
        offerRadiusM: radiusM,
        commissionRate: VALET_COMMISSION_RATE,
      });

      const timeout = {
        type: VALET_ACCEPT_TIMEOUT_JOB,
        availableAt: new Date(Date.now() + ACCEPT_TIMEOUT_MS),
        payload: { jobId: job.id, round: 0 },
      };

      if (candidates.length === 0) {
        /**
         * No supply inside the first radius. The request does not fail — the
         * timeout job widens the search, and the driver sees "finding a valet".
         * Failing here would make a momentary gap in coverage look like a broken
         * feature, and the next radius is two minutes away.
         */
        await this.outbox.enqueue(tx, timeout);
        return { job, offeredTo: 0 };
      }

      const offered = await this.valet.applyEvent(tx, job, 'offer', { offeredAt: new Date() });
      await this.valet.recordOffers(tx, job.id, 0, candidates);

      await this.outbox.enqueue(
        tx,
        timeout,
        ...candidates.map((candidate) => notifyOffer(job.id, candidate)),
      );

      return { job: offered, offeredTo: candidates.length };
    });
  }
}

/**
 * The push a valet sees. Carries the earnings, not the fee: a partner deciding
 * whether to drive needs the number that lands in their account.
 *
 * Priced from the candidate's own distance at the platform rate rather than from
 * the job row, because the job has no `commission_rate` applied to a leg yet —
 * nobody has accepted, and each candidate is a different distance away.
 */
export function notifyOffer(jobId: string, candidate: OfferCandidate) {
  const fee = computeValetLegFee(candidate.distanceM, VALET_COMMISSION_RATE);
  return {
    type: 'notification.dispatch' as const,
    payload: {
      userId: candidate.userId,
      template: 'valet.new_job',
      data: {
        jobId,
        distanceM: Math.round(candidate.distanceM),
        earningsPaise: fee.valetEarningsPaise,
      },
    },
  };
}
