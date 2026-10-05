import { outboxMessages } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { outboxRoute } from '../../queues.js';

const BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 10;

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
      const route = outboxRoute(message.type);
      if (route === 'event') {
        // Recorded for a subscriber that does not exist yet: done, with nothing to send.
        await tx
          .update(outboxMessages)
          .set({ status: 'dispatched', dispatchedAt: new Date(), updatedAt: new Date() })
          .where(eq(outboxMessages.id, message.id));
        continue;
      }
      try {
        // A type nobody registered: pg-boss would answer null and the message would vanish
        // (S-104). It takes the retry path, so a worker deployed after the API can still catch up,
        // and fails for good — loudly — only at MAX_ATTEMPTS.
        if (route === 'unknown') {
          throw new Error(`no queue for message type ${message.type}`);
        }
        const jobId = await deps.boss.send(message.type, message.payload, {
          singletonKey: message.id,
          retryLimit: 5,
          retryBackoff: true,
        });
        // null is either the singletonKey duplicate of a send that already landed (fine), or a job
        // pg-boss silently did not create because its queue is gone (not fine). Only the job table
        // tells them apart.
        if (jobId === null) {
          const [existing] = await tx.execute<{ id: string }>(sql`
            SELECT id FROM pgboss.job
            WHERE name = ${message.type} AND singleton_key = ${message.id}
            LIMIT 1`);
          if (existing === undefined) {
            throw new Error(`pg-boss created no job for ${message.type}; is its queue missing?`);
          }
        }
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
        const giveUp = newAttempts >= MAX_ATTEMPTS;
        const context = {
          err: error,
          messageId: message.id,
          type: message.type,
          attempts: newAttempts,
        };
        if (giveUp) logger.error(context, 'outbox relay gave up; message failed');
        else logger.warn(context, 'outbox relay failed; will retry');
        await tx
          .update(outboxMessages)
          .set({
            attempts: newAttempts,
            lastError: String(error),
            availableAt: backoffSeconds(newAttempts),
            status: giveUp ? 'failed' : 'pending',
            updatedAt: new Date(),
          })
          .where(eq(outboxMessages.id, message.id));
      }
    }
  });
}
