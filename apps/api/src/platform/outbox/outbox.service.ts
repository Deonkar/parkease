import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { outboxMessages } from '@parkease/db/schema';

import type { TxHandle } from '../db/transaction.js';
import { txContext } from '../db/transaction.js';

export interface OutboxMessage {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /**
   * When the relay may first pick this message up. Omit for "as soon as
   * possible"; give one for work that is scheduled rather than reactive — the
   * ten-minute payment expiry, the reminder half an hour before a booking, the
   * completion at `ends_at`.
   *
   * A delay belongs on the message, not on a cron that sweeps for due rows: the
   * schedule then commits in the same transaction as the row that justifies it,
   * so a booking can never exist without its expiry already scheduled.
   */
  readonly availableAt?: Date;
}

@Injectable()
export class OutboxService {
  async enqueue(tx: TxHandle, ...messages: readonly OutboxMessage[]): Promise<void> {
    if (!txContext.getStore()) {
      throw new Error(
        'OutboxService.enqueue was called outside a transaction. Wrap the write ' +
          'in db.transaction() so the message commits with the row that justifies it.',
      );
    }

    if (messages.length === 0) return;

    await tx.insert(outboxMessages).values(
      messages.map((message) => ({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt === undefined ? {} : { availableAt: message.availableAt }),
        traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
      })),
    );
  }
}
