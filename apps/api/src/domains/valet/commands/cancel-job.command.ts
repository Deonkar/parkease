import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeValetLegFee,
  computeValetNoShowFee,
  valetChargeAdjustmentEntries,
} from '@parkease/contracts/money';
import { toRate } from '@parkease/contracts/primitives';
import { parseValetJobStatus, valetHoldsVehicle } from '@parkease/contracts/valet';
import { uuidv7 } from '@parkease/db';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { ValetHoldsVehicleError } from '../errors.js';
import { LocationService } from '../location.service.js';
import { type ValetJobRow, ValetService } from '../valet.service.js';

export interface CancelJobInput {
  readonly jobId: string;
  readonly driverId: string;
  readonly reason?: string;
}

/**
 * A driver calling the whole thing off.
 *
 * Two outcomes, decided by how far the job got. Before anyone moved, in
 * requested or offered, it is free and posts nothing at all. Once a valet was
 * dispatched, in accepted, en_route or arrived, the driver owes the call-out
 * exactly as in a no-show, because the valet did the work they were asked to do
 * (section 11.8).
 *
 * From parking onward this route is closed. A stranger has the keys, and a state
 * transition is the wrong tool for changing your mind while someone else is
 * driving your car — that is a support path with a human in it.
 */
@Injectable()
export class CancelJobCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly valet: ValetService,
    private readonly ledger: LedgerService,
    private readonly location: LocationService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: CancelJobInput): Promise<ValetJobRow> {
    const job = await this.valet.findOwnedByDriver(input.jobId, input.driverId);
    if (job === undefined) throw new NotFoundException();

    // Checked before the machine, so the driver is handed the support path
    // rather than a generic "cannot move there" (R-GEN-06).
    if (valetHoldsVehicle(parseValetJobStatus(job.status))) throw new ValetHoldsVehicleError();

    const updated = await withTransaction(this.db, async (tx) => {
      const cancelled = await this.valet.applyEvent(tx, job, 'cancel', {
        cancelledAt: new Date(),
        cancellationReason: input.reason ?? 'driver_cancelled',
      });

      /**
       * Nobody moved, so nobody pays. A job cancelled from requested or offered
       * has no txn id and posts no entries at all — not a zero posting, which
       * assertEntriesBalance rejects anyway.
       *
       * Written as a narrowing guard rather than a boolean: the three columns
       * are nullable together, and checking them here is what lets the posting
       * below use them without an assertion that would outlive the reason for it.
       */
      const { txnId, feePaise, assignedUserId: valetUserId } = job;
      if (txnId === null || feePaise === null || valetUserId === null) return cancelled;
      const rate = toRate(Number(job.commissionRate));
      const charged = computeValetLegFee(job.distanceM ?? 0, rate);
      const retained = computeValetNoShowFee(rate);

      const entries = valetChargeAdjustmentEntries(
        charged,
        retained,
        valetUserId,
        'valet cancelled after dispatch',
      );

      // Empty when the leg was already priced at exactly the call-out fee, which
      // happens at zero distance. Nothing to give back, so nothing is posted.
      if (entries.length > 0) {
        await this.ledger.post(tx, {
          txnId: uuidv7(),
          bookingId: job.bookingId,
          entries,
        });

        await this.outbox.enqueue(tx, {
          type: 'payment.issue-refund',
          payload: {
            txnId,
            amountPaise: charged.driverTotalPaise - retained.driverTotalPaise,
          },
        });
      }

      await this.outbox.enqueue(tx, {
        type: 'notification.dispatch',
        payload: {
          userId: valetUserId,
          template: 'valet.cancelled',
          data: { jobId: job.id },
        },
      });

      return cancelled;
    });

    // After the commit, and best-effort by design. See LocationService.forget.
    await this.location.forget(job.id);
    return updated;
  }
}
