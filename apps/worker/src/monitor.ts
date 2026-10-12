import { sql } from 'drizzle-orm';

import type { JobDeps } from './deps.js';
import { logger } from './logger.js';
import { QUEUE_REGISTRY, type QueueName, type QueueSlo, type QueueTier } from './queues.js';

/** How often the in-process monitor looks. pg-boss cron cannot go below a minute. */
export const QUEUE_MONITOR_INTERVAL_MS = 30_000;

/** Jobs waiting in one pg-boss queue, as the monitor's query reads them. */
export interface QueueDepth {
  readonly name: string;
  /** created or retry, including jobs held back by a retry delay. */
  readonly waiting: number;
  /** waiting and due now. */
  readonly ready: number;
  /** Seconds the oldest ready job has been due; 0 when none is. */
  readonly oldestReadySeconds: number;
  /** Seconds since the oldest waiting job was created; for a dead letter, since it landed. */
  readonly oldestCreatedSeconds: number;
}

export interface SloBreach {
  readonly queue: QueueName;
  readonly tier: QueueTier;
  readonly ready: number;
  readonly oldestReadySeconds: number;
  readonly slo: QueueSlo;
}

export interface DeadLetters {
  readonly queue: QueueName;
  readonly tier: QueueTier;
  readonly deadLetterQueue: string;
  readonly count: number;
  readonly oldestSeconds: number;
}

export interface QueueHealth {
  readonly breaches: SloBreach[];
  readonly deadLetters: DeadLetters[];
}

/** Holds every registry queue to its tier's SLO, and reports every dead-letter queue not empty. */
export function evaluateQueueHealth(depths: readonly QueueDepth[]): QueueHealth {
  const byName = new Map(depths.map((d) => [d.name, d]));
  const breaches: SloBreach[] = [];
  const deadLetters: DeadLetters[] = [];
  for (const q of QUEUE_REGISTRY) {
    const depth = byName.get(q.name);
    if (
      depth !== undefined &&
      (depth.ready > q.slo.maxReady || depth.oldestReadySeconds > q.slo.maxWaitSeconds)
    ) {
      breaches.push({
        queue: q.name,
        tier: q.tier,
        ready: depth.ready,
        oldestReadySeconds: depth.oldestReadySeconds,
        slo: q.slo,
      });
    }
    const dead = byName.get(q.deadLetter);
    if (dead !== undefined && dead.waiting > 0) {
      deadLetters.push({
        queue: q.name,
        tier: q.tier,
        deadLetterQueue: q.deadLetter,
        count: dead.waiting,
        oldestSeconds: dead.oldestCreatedSeconds,
      });
    }
  }
  return { breaches, deadLetters };
}

/**
 * Reads every queue's depth in one query. `state < 'active'` is pg-boss's own "waiting" (created
 * or retry) and the predicate its fetch index is built on. A job whose retry delay has not passed
 * is waiting but not ready, so it does not count as lag: that wait is deliberate.
 */
export async function readQueueDepths(deps: JobDeps): Promise<QueueDepth[]> {
  const rows = await deps.db.execute<{
    name: string;
    waiting: number;
    ready: number;
    oldest_ready_seconds: number;
    oldest_created_seconds: number;
  }>(sql`
    SELECT name,
           count(*)::int AS waiting,
           count(*) FILTER (WHERE start_after <= now())::int AS ready,
           coalesce(extract(epoch FROM now() - min(start_after)
                    FILTER (WHERE start_after <= now())), 0)::float8 AS oldest_ready_seconds,
           coalesce(extract(epoch FROM now() - min(created_on)), 0)::float8
             AS oldest_created_seconds
    FROM pgboss.job
    WHERE state < 'active'
    GROUP BY name
  `);
  return rows.map((r) => ({
    name: r.name,
    waiting: r.waiting,
    ready: r.ready,
    oldestReadySeconds: Math.max(0, r.oldest_ready_seconds),
    oldestCreatedSeconds: Math.max(0, r.oldest_created_seconds),
  }));
}

/**
 * One monitor pass. A dead letter is an alert — `DEAD_LETTER` at error, every pass while the
 * dead-letter queue holds anything, the way `LEDGER_IMBALANCE` repeats while the ledger is off —
 * because a job there exhausted its retries and nothing will run it again without a human. A
 * queue past its tier's SLO is `QUEUE_SLO` at warn: late, not lost.
 */
export async function checkQueues(deps: JobDeps): Promise<QueueHealth> {
  const health = evaluateQueueHealth(await readQueueDepths(deps));
  for (const breach of health.breaches) {
    logger.warn(
      {
        queue: breach.queue,
        tier: breach.tier,
        ready: breach.ready,
        oldestReadySeconds: Math.round(breach.oldestReadySeconds),
        maxReady: breach.slo.maxReady,
        maxWaitSeconds: breach.slo.maxWaitSeconds,
      },
      'QUEUE_SLO: a queue is behind its tier SLO',
    );
  }
  for (const dead of health.deadLetters) {
    const [sample] = await deps.db.execute<{ ids: string[] }>(sql`
      SELECT array_agg(id::text ORDER BY created_on DESC) AS ids
      FROM (SELECT id, created_on FROM pgboss.job
            WHERE name = ${dead.deadLetterQueue} AND state < 'active'
            ORDER BY created_on DESC LIMIT 5) newest`);
    logger.error(
      {
        queue: dead.queue,
        tier: dead.tier,
        deadLetterQueue: dead.deadLetterQueue,
        count: dead.count,
        oldestSeconds: Math.round(dead.oldestSeconds),
        jobIds: sample?.ids ?? [],
      },
      'DEAD_LETTER: jobs exhausted their retries and wait for a human',
    );
  }
  return health;
}

/**
 * Runs `checkQueues` every `intervalMs` in-process, like the outbox pump: it does not depend on a
 * pg-boss worker or cron being healthy, which is exactly when it is needed. Each replica logs; the
 * alert dedupes on its message.
 */
export function startQueueMonitor(
  deps: JobDeps,
  intervalMs = QUEUE_MONITOR_INTERVAL_MS,
): { stop: () => Promise<void> } {
  let running: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    running = checkQueues(deps).catch((error: unknown) => {
      logger.error({ err: error }, 'queue monitor pass failed; next pass will retry');
    });
  }, intervalMs);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}
