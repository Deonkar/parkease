import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ValetJobEvent } from '@parkease/contracts/enums';
import { NO_SHOW_GRACE_MS, VALET_NO_SHOW_JOB } from '@parkease/contracts/valet';
import { valetJobs } from '@parkease/db/schema';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { ProofPhotoRequiredError } from '../errors.js';
import { LocationService } from '../location.service.js';
import { type ValetJobRow, ValetService } from '../valet.service.js';

export interface AdvanceJobInput {
  readonly jobId: string;
  readonly valetUserId: string;
  readonly event: Extract<
    ValetJobEvent,
    'depart' | 'arrive' | 'start_parking' | 'confirm_parked' | 'depart_return' | 'complete'
  >;
  readonly proofPhotoId?: string;
}

/**
 * Every lifecycle move a valet makes, through one command.
 *
 * The event decides which columns move with the status; the transition table
 * decides whether the move is legal at all. Neither decision is the controller's
 * (rule 2: controllers authorise and delegate).
 */
@Injectable()
export class AdvanceJobCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly valet: ValetService,
    private readonly location: LocationService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: AdvanceJobInput): Promise<ValetJobRow> {
    const job = await this.valet.findAssignedTo(input.jobId, input.valetUserId);
    // Not assigned to you → 404. A valet who lost the race learns nothing.
    if (job === undefined) throw new NotFoundException();

    /**
     * The server enforcing what task 12 also gates in the client. A parked-car
     * photo is the only evidence the driver has of where their car went and what
     * state it was in, so "confirm parked" without one is not a claim we accept.
     */
    const proofPhotoId = input.proofPhotoId ?? job.proofPhotoId;
    if (input.event === 'confirm_parked' && (proofPhotoId ?? '') === '') {
      throw new ProofPhotoRequiredError();
    }

    const now = new Date();
    const patch: Partial<typeof valetJobs.$inferInsert> = {};
    if (input.event === 'arrive') patch.arrivedAt = now;
    if (input.event === 'confirm_parked') {
      patch.parkedAt = now;
      patch.proofPhotoId = proofPhotoId;
    }
    if (input.event === 'complete') patch.completedAt = now;

    const updated = await withTransaction(this.db, async (tx) => {
      const next = await this.valet.applyEvent(tx, job, input.event, patch);

      /**
       * Scheduled inside the same transaction as the status it depends on
       * (R-ASYNC-02). Roll the arrival back and the no-show job never existed;
       * there is no window in which a job is `arrived` with nothing watching it.
       */
      if (input.event === 'arrive') {
        await this.outbox.enqueue(tx, {
          type: VALET_NO_SHOW_JOB,
          availableAt: new Date(now.getTime() + NO_SHOW_GRACE_MS),
          payload: { jobId: job.id },
        });
      }

      if (input.event === 'confirm_parked') {
        await this.outbox.enqueue(tx, {
          type: 'notification.dispatch',
          payload: {
            userId: job.driverUserId,
            template: 'valet.parked',
            data: { jobId: job.id, proofPhotoId },
          },
        });
      }

      return next;
    });

    /**
     * Outside the transaction, and deliberately best-effort: the car is
     * stationary in a space whose address the driver already has, so continuing
     * to serve its last fix has no product value and broadcasting a parked
     * vehicle's position for hours is a liability (security.md §5.3).
     *
     * A Redis failure here must not fail a request whose transaction already
     * committed — the valet would be told the car could not be parked, for a car
     * that is parked. `LocationService.forget` handles and logs it at warn for
     * exactly that reason, and the key expires on its own in 30s regardless.
     */
    if (input.event === 'confirm_parked' || input.event === 'complete') {
      await this.location.forget(job.id);
    }

    return updated;
  }
}
