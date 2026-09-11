import { outboxMessages } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 10;

function backoffSeconds(attempts: number): Date {
  const seconds = Math.min(2 ** attempts * 10, 3600);
  return new Date(Date.now() + seconds * 1000);
}

export async function relayOutbox(deps: JobDeps): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const batch = await tx.execute<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      trace_id: string | null;
      attempts: number;
    }>(sql`
      SELECT id, type, payload, trace_id, attempts
      FROM outbox_messages
      WHERE status = 'pending' AND available_at <= now()
      ORDER BY available_at, id
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `);

    for (const message of batch) {
      try {
        await deps.boss.send(message.type, message.payload, {
          singletonKey: message.id,
          retryLimit: 5,
          retryBackoff: true,
        });
        await tx
          .update(outboxMessages)
          .set({
            status: 'dispatched',
            dispatchedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(outboxMessages.id, message.id));
      } catch (error) {
        const newAttempts = message.attempts + 1;
        logger.warn(
          { err: error, messageId: message.id, attempts: newAttempts },
          'outbox relay failed',
        );
        await tx
          .update(outboxMessages)
          .set({
            attempts: newAttempts,
            lastError: String(error),
            availableAt: backoffSeconds(newAttempts),
            status: newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            updatedAt: new Date(),
          })
          .where(eq(outboxMessages.id, message.id));
      }
    }
  });
}
