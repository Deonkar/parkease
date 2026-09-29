import { Inject, Injectable } from '@nestjs/common';
import type { RouteStatus } from '@parkease/contracts/enums';
import type { RouteRequirement } from '@parkease/contracts/shared';
import { linkedAccounts } from '@parkease/db/schema';
import { and, eq, ne } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { logger } from '../../../platform/observability/logger.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';

/** The statuses worth telling the payee about; `under_review` is what they already see. */
const TEMPLATES: Partial<Record<RouteStatus, string>> = {
  activated: 'payout.route_activated',
  needs_clarification: 'payout.route_needs_clarification',
  rejected: 'payout.route_rejected',
  suspended: 'payout.route_suspended',
};

/**
 * A Route product webhook (task 16b): the Linked Account's status and what Razorpay needs
 * clarified. Idempotent by its own WHERE: the row changes only when the status does, and the
 * notification commits with that change, so a redelivery with a new event id is a no-op.
 * An account we do not know is logged and answered 200 — it can only be another integration
 * on the same Razorpay account, and a retry would never make it ours.
 */
@Injectable()
export class ApplyRouteStatusCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: {
    razorpayAccountId: string;
    status: RouteStatus;
    requirements: RouteRequirement[];
  }): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const [changed] = await tx
        .update(linkedAccounts)
        .set({ kycStatus: input.status, requirements: input.requirements, updatedAt: new Date() })
        .where(
          and(
            eq(linkedAccounts.razorpayAccountId, input.razorpayAccountId),
            ne(linkedAccounts.kycStatus, input.status),
          ),
        )
        .returning({ userId: linkedAccounts.userId });

      if (changed === undefined) {
        const [known] = await tx
          .select({ id: linkedAccounts.id })
          .from(linkedAccounts)
          .where(eq(linkedAccounts.razorpayAccountId, input.razorpayAccountId));
        if (known === undefined) {
          logger.warn(
            { status: input.status },
            'route webhook for a Linked Account we do not hold',
          );
        }
        return;
      }

      const template = TEMPLATES[input.status];
      if (template !== undefined) {
        await this.outbox.enqueue(tx, {
          type: 'notification.dispatch',
          payload: { userId: changed.userId, template, data: { status: input.status } },
        });
      }
    });
  }
}
