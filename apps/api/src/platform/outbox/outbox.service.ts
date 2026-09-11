import { Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { outboxMessages } from '@parkease/db/schema';

import type { TxHandle } from '../db/transaction.js';
import { txContext } from '../db/transaction.js';

export interface OutboxMessage {
  readonly type: string;
  readonly payload: Record<string, unknown>;
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

    await tx.insert(outboxMessages).values(
      messages.map((message) => ({
        type: message.type,
        payload: message.payload,
        traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
      })),
    );
  }
}
