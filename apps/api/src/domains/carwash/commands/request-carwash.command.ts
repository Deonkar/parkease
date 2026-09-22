import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import { CARWASH_COMMISSION_RATE, computeWashFee } from '@parkease/contracts/money';
import type { Paise } from '@parkease/contracts/primitives';
import {
  CARWASH_ACCEPT_TIMEOUT_JOB,
  WASH_ACCEPT_TIMEOUT_MS,
  WASH_OFFER_RADII_M,
} from '@parkease/contracts/washer';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { WashAssignmentService } from '../assignment.service.js';
import { CarwashService, type WashJobRow, type WashOfferCandidate } from '../carwash.service.js';

export interface RequestCarwashInput {
  readonly driverId: string;
  readonly bookingId: string;
  readonly serviceName: CarwashServiceName;
  readonly vehicleType: VehicleType;
}

export interface RequestCarwashResult {
  readonly job: WashJobRow;
  readonly offeredTo: number;
}

@Injectable()
export class RequestCarwashCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly assignment: WashAssignmentService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: RequestCarwashInput): Promise<RequestCarwashResult> {
    const booking = await this.carwash.findOwnedBooking(input.bookingId, input.driverId);
    if (booking === undefined) throw new NotFoundException();

    // The precondition this whole task turns on: the car must be parked.
    this.carwash.assertBookingIsWashEligible(booking.status);
    await this.carwash.assertNoLiveWashForBooking(booking.id, input.serviceName);

    const radiusM = WASH_OFFER_RADII_M[0];

    /**
     * The candidate search runs *before* the transaction opens. It is a read,
     * it can be slow on a cold GiST index, and holding a write transaction open
     * across it would put every concurrent wash request behind it (R-BE-04).
     *
     * The origin is the booked space's location, not the driver's position: the
     * car is at the space, and that is where the partner goes.
     */
    const candidates = await this.assignment.findCandidates({
      origin: this.carwash.spaceLocationOf(booking.id),
      radiusM,
      excludeUserId: input.driverId,
      jobId: null,
      serviceName: input.serviceName,
      vehicleType: input.vehicleType,
    });

    return withTransaction(this.db, async (tx) => {
      const job = await this.carwash.insert(tx, {
        bookingId: booking.id,
        driverUserId: input.driverId,
        serviceName: input.serviceName,
        vehicleType: input.vehicleType,
        offerRadiusM: radiusM,
        commissionRate: CARWASH_COMMISSION_RATE,
      });

      const timeout = {
        type: CARWASH_ACCEPT_TIMEOUT_JOB,
        availableAt: new Date(Date.now() + WASH_ACCEPT_TIMEOUT_MS),
        payload: { jobId: job.id, round: 0 },
      };

      if (candidates.length === 0) {
        /**
         * No supply inside the first radius. The request does not fail — the
         * timeout job widens the search, and the driver sees "finding a
         * partner". Failing here would make a momentary gap in coverage look
         * like a broken feature, and the next radius is three minutes away.
         */
        await this.outbox.enqueue(tx, timeout);
        return { job, offeredTo: 0 };
      }

      const offered = await this.carwash.applyEvent(tx, job, 'offer', { offeredAt: new Date() });
      await this.carwash.recordOffers(tx, job.id, 0, candidates);

      await this.outbox.enqueue(
        tx,
        timeout,
        ...candidates.map((candidate) => notifyWashOffer(job.id, input.serviceName, candidate)),
      );

      return { job: offered, offeredTo: candidates.length };
    });
  }
}

/**
 * The push a partner sees. Carries their earnings, not the price and not the
 * driver's total: somebody deciding whether to load a van and drive needs the
 * number that lands in their account.
 *
 * Priced from the candidate's **own** menu row, which the candidate query
 * returned alongside them. Three partners offered the same job may quote three
 * different numbers, so a single job-level price would be wrong for at least
 * two of them.
 */
export function notifyWashOffer(
  jobId: string,
  serviceName: CarwashServiceName,
  candidate: WashOfferCandidate,
) {
  const fee = computeWashFee(candidate.pricePaise as Paise, CARWASH_COMMISSION_RATE);
  return {
    type: 'notification.dispatch' as const,
    payload: {
      userId: candidate.userId,
      template: 'washer.new_job',
      data: {
        jobId,
        serviceName,
        distanceM: Math.round(candidate.distanceM),
        earningsPaise: fee.washerEarningsPaise,
      },
    },
  };
}
