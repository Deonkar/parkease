import { EVENT_NOTIFICATIONS } from '@parkease/contracts/shared';
import { outboxMessages } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { outboxRoute } from '../../queues.js';

const BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 10;

/** prd.md §12: a message waits at most this long between being ready and being dispatched. */
export const OUTBOX_LAG_BUDGET_SECONDS = 30;

/**
 * One pass stops taking new batches after this long, so a deep backlog cannot pin the worker. The
 * next pass carries on where it stopped.
 */
const DRAIN_BUDGET_MS = 10_000;

/** How often the in-process pump runs a pass. pg-boss cron cannot go below one minute. */
export const OUTBOX_PUMP_INTERVAL_MS = 1_000;

function backoffSeconds(attempts: number): Date {
  const seconds = Math.min(2 ** attempts * 10, 3600);
  return new Date(Date.now() + seconds * 1000);
}

export interface RelayPass {
  relayed: number;
  /** Age of the oldest ready message when the pass began; 0 when nothing was waiting. */
  lagSeconds: number;
}

/**
 * Relays until nothing ready is left (or the drain budget runs out), one transaction per batch.
 *
 * A single batch per call capped the system at 100 messages per cron tick — once a minute — so
 * any burst above that only ever grew, and a lone message waited up to a minute for the tick. The
 * lag is read before draining, so the alert reports how long the oldest message actually waited.
 */
export async function relayOutbox(deps: JobDeps): Promise<RelayPass> {
  const lagSeconds = await outboxLagSeconds(deps);
  if (lagSeconds > OUTBOX_LAG_BUDGET_SECONDS) {
    logger.error(
      { lagSeconds, budgetSeconds: OUTBOX_LAG_BUDGET_SECONDS },
      'OUTBOX_LAG: the oldest ready outbox message has waited past its budget',
    );
  }

  const deadline = Date.now() + DRAIN_BUDGET_MS;
  let relayed = 0;
  for (;;) {
    const taken = await relayBatch(deps);
    relayed += taken;
    if (taken < BATCH_SIZE || Date.now() >= deadline) return { relayed, lagSeconds };
  }
}

/**
 * Seconds the oldest ready message has been waiting. A message held back by retry backoff is not
 * ready, so it does not count: that wait is deliberate.
 */
export async function outboxLagSeconds(deps: JobDeps): Promise<number> {
  const [row] = await deps.db.execute<{ lag: number | null }>(sql`
    SELECT extract(epoch FROM now() - min(available_at))::float8 AS lag
    FROM outbox_messages
    WHERE status = 'pending' AND available_at <= now()
  `);
  return Math.max(0, row?.lag ?? 0);
}

/**
 * Runs a relay pass every `intervalMs` until stopped. Several workers can pump at once:
 * `FOR UPDATE SKIP LOCKED` hands each batch to one of them, and the singleton key stops a
 * duplicate job if a pass rolls back after a send.
 *
 * The minute cron job stays registered as the safety net for a pump that has died.
 */
export function startOutboxPump(
  deps: JobDeps,
  intervalMs = OUTBOX_PUMP_INTERVAL_MS,
): { stop: () => Promise<void> } {
  let stopped = false;
  // Read through a function: `stop()` flips the flag from outside this loop's control flow.
  const isStopped = () => stopped;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;

  const loop = (async () => {
    while (!isStopped()) {
      try {
        await relayOutbox(deps);
      } catch (error) {
        logger.error({ err: error }, 'outbox pump pass failed; next pass will retry');
      }
      if (isStopped()) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, intervalMs);
      });
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      wake?.();
      await loop;
    },
  };
}

async function relayBatch(deps: JobDeps): Promise<number> {
  return deps.db.transaction(async (tx) => {
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
      // A domain event that also tells someone something is sent on as a notification job
      // (task 19); the outbox message id stays the pg-boss singleton key, so a retry sends once.
      const eventMap = Object.hasOwn(EVENT_NOTIFICATIONS, message.type)
        ? EVENT_NOTIFICATIONS[message.type]
        : undefined;
      const notification = eventMap?.(message.payload);
      if (eventMap !== undefined && notification === null) {
        // No recipient in the payload: nobody to tell, and a retry cannot add one. Loud, then done.
        logger.warn(
          { messageId: message.id, type: message.type },
          'event has no notification recipient',
        );
      }
      const route = notification ? 'job' : outboxRoute(message.type);
      const sendType = notification ? 'notification.dispatch' : message.type;
      const sendPayload = notification ?? message.payload;
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
        const jobId = await deps.boss.send(sendType, sendPayload, {
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
            WHERE name = ${sendType} AND singleton_key = ${message.id}
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
    return batch.length;
  });
}
