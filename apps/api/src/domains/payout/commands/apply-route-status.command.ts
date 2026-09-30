import { Inject, Injectable } from '@nestjs/common';
import type { RouteStatus } from '@parkease/contracts/enums';
import type { RouteRequirement } from '@parkease/contracts/shared';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { logger } from '../../../platform/observability/logger.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { CommissionWaiverService } from '../../pricing/commission-waiver.service.js';
import { PayoutService } from '../payout.service.js';

/** The statuses worth telling the payee about; `under_review` is what they already see. */
const TEMPLATES: Partial<Record<RouteStatus, string>> = {
  activated: 'payout.route_activated',
  needs_clarification: 'payout.route_needs_clarification',
  rejected: 'payout.route_rejected',
  suspended: 'payout.route_suspended',
};

/**
 * A Route product webhook (task 16b): the Linked Account's status and what Razorpay needs
 * clarified. Ordered by the event's own time (`PayoutService.applyRouteStatus`), so a
 * redelivery or a late, older event is a no-op; a newer event with the same status still
 * refreshes `requirements`. The payee is told only when the status itself changed, in the
 * same commit.
 * An account we do not know is logged and answered 200 — it can only be another integration
 * on the same Razorpay account, and a retry would never make it ours.
 */
@Injectable()
export class ApplyRouteStatusCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payouts: PayoutService,
    private readonly outbox: OutboxService,
    private readonly waivers: CommissionWaiverService,
  ) {}

  async execute(input: {
    razorpayAccountId: string;
    eventId: string;
    status: RouteStatus;
    requirements: RouteRequirement[];
    at: Date;
  }): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const result = await this.payouts.applyRouteStatus(
        tx,
        { razorpayAccountId: input.razorpayAccountId },
        { status: input.status, requirements: input.requirements, at: input.at, stamp: true },
      );

      if (result.outcome === 'unknown') {
        // Razorpay's account id is not a secret; without it the orphan cannot be reconciled.
        logger.warn(
          {
            razorpayAccountId: input.razorpayAccountId,
            eventId: input.eventId,
            status: input.status,
          },
          'route webhook for a Linked Account we do not hold',
        );
        return;
      }
      if (result.outcome === 'stale') {
        logger.info(
          { eventId: input.eventId, status: input.status },
          'route webhook older than the stored status ignored',
        );
        return;
      }

      const template = TEMPLATES[input.status];
      if (template !== undefined && result.previous !== input.status) {
        await this.outbox.enqueue(tx, {
          type: 'notification.dispatch',
          payload: { userId: result.userId, template, data: { status: input.status } },
        });
      }

      // The first activation is when an owner can first be paid: the commission-free window
      // starts here, if a slot is left (task 16c). A reactivation keeps its original window.
      if (input.status === 'activated' && result.previous !== 'activated') {
        await this.waivers.grantIfEligible(tx, result.userId, input.at);
      }
    });
  }
}
