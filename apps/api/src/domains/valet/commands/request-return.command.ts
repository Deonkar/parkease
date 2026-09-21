import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeValetLegFee, valetLegEntries } from '@parkease/contracts/money';
import { toRate } from '@parkease/contracts/primitives';
import { uuidv7 } from '@parkease/db';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { type ValetJobRow, ValetService } from '../valet.service.js';

export interface RequestReturnInput {
  readonly jobId: string;
  readonly driverId: string;
  readonly dropLocation: {
    readonly lat: number;
    readonly lng: number;
    readonly address: string;
  };
}

/**
 * The return leg, as its own charge.
 *
 * The driver pays, separately, when they ask. The return distance is not
 * knowable at pickup — they may want the car at a different address, hours
 * later — so the alternatives were quoting a round trip at a distance we would
 * have to guess, or holding an open-ended authorisation on their card. Both are
 * worse than a second explicit charge, approved once the destination is known.
 *
 * Its own txn id, its own ledger transaction (section 11.6).
 */
@Injectable()
export class RequestReturnCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly valet: ValetService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: RequestReturnInput): Promise<ValetJobRow> {
    const job = await this.valet.findOwnedByDriver(input.jobId, input.driverId);
    if (job === undefined) throw new NotFoundException();

    /**
     * The assignee-presence CHECK makes a null assignee unreachable in every
     * status this transition is legal from, but the type does not know that, and
     * crediting a return leg to nobody would be a silent misposting rather than
     * a crash. Stated as an invariant violation, not handled as a case.
     */
    const valetUserId = job.assignedUserId;
    if (valetUserId === null) {
      throw new Error(
        `Valet job ${job.id} is ${job.status} with no assignee; refusing to post a leg`,
      );
    }

    // Distance in SQL, on the geography type, in metres. Never haversine in JS,
    // and never from a destructured geography column (ADR-004, R-DB-07).
    const distanceM = await this.valet.distanceFromSpaceToPoint(job.bookingId, input.dropLocation);
    const fee = computeValetLegFee(distanceM, toRate(Number(job.commissionRate)));
    const txnId = uuidv7();

    return withTransaction(this.db, async (tx) => {
      const updated = await this.valet.applyEvent(tx, job, 'request_return', {
        returnRequestedAt: new Date(),
        returnDropLocation: { lng: input.dropLocation.lng, lat: input.dropLocation.lat },
        returnDistanceM: Math.round(distanceM),
        returnFeePaise: fee.feePaise,
        returnTxnId: txnId,
      });

      await this.ledger.post(tx, {
        txnId,
        bookingId: job.bookingId,
        entries: valetLegEntries(fee, valetUserId, 'valet return leg'),
      });

      await this.outbox.enqueue(tx, {
        type: 'notification.dispatch',
        payload: {
          userId: valetUserId,
          template: 'valet.return_requested',
          data: { jobId: job.id, address: input.dropLocation.address },
        },
      });

      return updated;
    });
  }
}
