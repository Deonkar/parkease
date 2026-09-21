import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeValetLegFee, valetLegEntries } from '@parkease/contracts/money';
import { toRate } from '@parkease/contracts/primitives';
import { uuidv7 } from '@parkease/db';
import { valetJobs } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { JobAlreadyTakenError } from '../errors.js';
import { type ValetJobRow, ValetService } from '../valet.service.js';

export interface AcceptJobInput {
  readonly jobId: string;
  readonly valetUserId: string;
  /** Where the valet is right now, for the outbound leg's distance. */
  readonly from: { readonly lat: number; readonly lng: number };
}

@Injectable()
export class AcceptJobCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly valet: ValetService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: AcceptJobInput): Promise<ValetJobRow> {
    const offer = await this.valet.findOfferFor(input.jobId, input.valetUserId);
    // Never offered this job → 404, not 409. A 409 would confirm the job exists,
    // which is a job-id oracle for anyone with a valet token (R-SEC-04).
    if (offer === undefined) throw new NotFoundException();

    const job = await this.valet.findById(input.jobId);
    if (job === undefined) throw new NotFoundException();

    /**
     * Priced before the transaction opens, from the valet's position at accept
     * rather than at arrival: freezing it here means the driver's quote cannot
     * move because the valet took a scenic route.
     */
    const distanceM = await this.valet.distanceFromSpaceToPoint(job.bookingId, input.from);
    const fee = computeValetLegFee(distanceM, toRate(Number(job.commissionRate)));
    const txnId = uuidv7();

    return withTransaction(this.db, async (tx) => {
      /**
       * The WHERE clause *is* the concurrency control.
       *
       * Five valets can run this simultaneously; PostgreSQL serialises the row
       * update and four of them match zero rows, because `status` is no longer
       * 'offered' by the time their turn comes. No SELECT FOR UPDATE, no
       * advisory lock, no retry loop — the same posture as the booking exclusion
       * constraint in ADR-007: make the database answer the race, rather than
       * arranging for it not to happen.
       */
      const updated = await tx
        .update(valetJobs)
        .set({
          status: 'accepted',
          assignedUserId: input.valetUserId,
          acceptedAt: new Date(),
          distanceM: Math.round(distanceM),
          feePaise: fee.feePaise,
          txnId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(valetJobs.id, input.jobId),
            eq(valetJobs.status, 'offered'),
            isNull(valetJobs.assignedUserId),
          ),
        )
        .returning();

      const accepted = updated[0];
      if (accepted === undefined) throw new JobAlreadyTakenError();

      await this.valet.resolveOffers(tx, accepted.id, input.valetUserId);

      /**
       * The outbound leg goes on the books here, in the same commit as the
       * assignment. A job that has an assignee but no receivable is a valet
       * driving for free, and there is no later moment at which both facts
       * become true together (R-BE-03).
       */
      await this.ledger.post(tx, {
        txnId,
        bookingId: accepted.bookingId,
        entries: valetLegEntries(fee, input.valetUserId, 'valet outbound leg'),
      });

      await this.outbox.enqueue(
        tx,
        {
          type: 'notification.dispatch',
          payload: {
            userId: accepted.driverUserId,
            template: 'valet.assigned',
            data: { jobId: accepted.id, valetUserId: input.valetUserId },
          },
        },
        {
          type: 'valet.offer-withdrawn',
          payload: { jobId: accepted.id, winnerUserId: input.valetUserId },
        },
      );

      return accepted;
    });
  }
}
