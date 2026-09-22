import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import { computeWashFee, washEntries } from '@parkease/contracts/money';
import type { Paise } from '@parkease/contracts/primitives';
import { toRate } from '@parkease/contracts/primitives';
import { CARWASH_COMPLETE_REMINDER_JOB } from '@parkease/contracts/washer';
import { uuidv7 } from '@parkease/db';
import { washJobs } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { CarwashService, type WashJobRow } from '../carwash.service.js';
import { CatalogService } from '../catalog.service.js';
import {
  ServiceNotOfferedError,
  WashJobAlreadyTakenError,
  WasherNotOnboardedError,
} from '../errors.js';

const MINUTE_MS = 60 * 1000;

export interface AcceptWashInput {
  readonly jobId: string;
  readonly washerUserId: string;
}

@Injectable()
export class AcceptWashCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly catalog: CatalogService,
    private readonly payments: PaymentService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: AcceptWashInput): Promise<WashJobRow> {
    const offer = await this.carwash.findOfferFor(input.jobId, input.washerUserId);
    // Never offered this job → 404, not 409. A 409 would confirm the job
    // exists, which is a job-id oracle for anyone with a washer token
    // (R-SEC-04).
    if (offer === undefined) throw new NotFoundException();

    const job = await this.carwash.findById(input.jobId);
    if (job === undefined) throw new NotFoundException();

    /**
     * The price is this partner's own, read from their menu and frozen onto the
     * job. The candidate query already required the row to exist and be active,
     * so reaching `ServiceNotOfferedError` means it was deactivated between the
     * offer and the accept — a real race rather than a client bug.
     */
    const service = await this.catalog.findServicePrice(
      input.washerUserId,
      job.serviceName as CarwashServiceName,
      job.vehicleType as VehicleType,
    );
    if (service === undefined) throw new ServiceNotOfferedError();

    /**
     * ADR-013. No activated Linked Account means there is nowhere to route this
     * partner's share when the driver pays.
     *
     * Refused here rather than at checkout: letting the job be taken first
     * would leave a driver with a partner on the way and no way to pay them,
     * and the partner having done work we cannot settle.
     */
    const linkedAccountId = await this.payments.activeLinkedAccountForUser(input.washerUserId);
    if (linkedAccountId === undefined) throw new WasherNotOnboardedError();

    const fee = computeWashFee(service.pricePaise as Paise, toRate(Number(job.commissionRate)));
    const txnId = uuidv7();

    return withTransaction(this.db, async (tx) => {
      /**
       * The WHERE clause *is* the concurrency control.
       *
       * Three partners can run this simultaneously; PostgreSQL serialises the
       * row update and two of them match zero rows, because `status` is no
       * longer 'offered' by the time their turn comes. No SELECT FOR UPDATE, no
       * advisory lock, no retry loop — the same posture as the booking
       * exclusion constraint in ADR-007: make the database answer the race,
       * rather than arranging for it not to happen.
       *
       * Note what is deliberately absent from this transaction: any call to
       * Razorpay. The order is minted by the driver's own pay action once a
       * price exists on the row. Minting it here would mean the two losers each
       * created an order at the gateway that no webhook will ever join to a
       * local row (rule 4, and R-BE-04).
       */
      const updated = await tx
        .update(washJobs)
        .set({
          status: 'accepted',
          washerUserId: input.washerUserId,
          acceptedAt: new Date(),
          pricePaise: service.pricePaise,
          txnId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(washJobs.id, input.jobId),
            eq(washJobs.status, 'offered'),
            isNull(washJobs.washerUserId),
          ),
        )
        .returning();

      const accepted = updated[0];
      if (accepted === undefined) throw new WashJobAlreadyTakenError();

      await this.carwash.resolveOffers(tx, accepted.id, input.washerUserId);

      /**
       * The wash goes on the books here, in the same commit as the assignment.
       * A job that has a partner but no receivable is somebody working for
       * free, and there is no later moment at which both facts become true
       * together (R-BE-03).
       */
      await this.ledger.post(tx, {
        txnId,
        bookingId: accepted.bookingId,
        entries: washEntries(fee, input.washerUserId, 'car wash service'),
      });

      await this.outbox.enqueue(
        tx,
        {
          type: 'notification.dispatch',
          payload: {
            userId: accepted.driverUserId,
            template: 'washer.assigned',
            data: { jobId: accepted.id, washerUserId: input.washerUserId },
          },
        },
        {
          type: 'carwash.offer-withdrawn',
          payload: { jobId: accepted.id, winnerUserId: input.washerUserId },
        },
        {
          /**
           * A nudge one service-duration from now, if the job is still
           * `washing` then. The duration comes from the menu row already read
           * for the price — the same row, not a second query.
           */
          type: CARWASH_COMPLETE_REMINDER_JOB,
          availableAt: new Date(Date.now() + service.durationMinutes * MINUTE_MS),
          payload: { jobId: accepted.id },
        },
      );

      return accepted;
    });
  }
}
