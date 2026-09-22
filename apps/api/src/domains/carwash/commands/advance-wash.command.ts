import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CarwashJobEvent } from '@parkease/contracts/enums';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { CarwashService, type WashJobRow } from '../carwash.service.js';
import { AfterPhotoRequiredError, BeforePhotoRequiredError } from '../errors.js';
import { assertTransition, parseCarwashJobStatus } from '../lifecycle.js';

export interface AdvanceWashInput {
  readonly jobId: string;
  readonly washerUserId: string;
  readonly event: Extract<CarwashJobEvent, 'en_route' | 'start_washing' | 'complete'>;
}

@Injectable()
export class AdvanceWashCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly carwash: CarwashService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: AdvanceWashInput): Promise<WashJobRow> {
    const job = await this.carwash.findAssignedTo(input.jobId, input.washerUserId);
    // Not assigned to this partner → 404, never 403. A 403 confirms the job is
    // real to somebody who has no business knowing (R-SEC-04, R-API-08).
    if (job === undefined) throw new NotFoundException();

    // The machine first: an illegal move is refused before the photo gates get
    // a chance to give a more specific-sounding reason for the wrong failure.
    assertTransition(parseCarwashJobStatus(job.status), input.event);

    /**
     * §13.8. The server enforcing what the partner app also disables.
     *
     * Checked here as well as by `wash_jobs_photo_gate_check`, and neither is
     * redundant: the constraint is what makes a bad row unreachable by any
     * path, and this is what turns the refusal into copy a partner can act on
     * rather than a 500 from a constraint name.
     */
    if (input.event === 'start_washing' && job.beforePhotoId === null) {
      throw new BeforePhotoRequiredError();
    }
    if (input.event === 'complete' && job.afterPhotoId === null) {
      throw new AfterPhotoRequiredError();
    }

    return withTransaction(this.db, async (tx) => {
      const updated = await this.carwash.applyEvent(tx, job, input.event, {
        ...(input.event === 'start_washing' ? { startedAt: new Date() } : {}),
        ...(input.event === 'complete' ? { completedAt: new Date() } : {}),
      });

      if (input.event === 'complete') {
        await this.outbox.enqueue(tx, {
          type: 'notification.dispatch',
          payload: {
            userId: job.driverUserId,
            template: 'washer.complete',
            data: {
              jobId: job.id,
              beforePhotoId: job.beforePhotoId,
              afterPhotoId: job.afterPhotoId,
            },
          },
        });
      }

      return updated;
    });
  }
}
