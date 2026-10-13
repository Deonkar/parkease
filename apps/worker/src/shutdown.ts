import type PgBoss from 'pg-boss';

import { logger } from './logger.js';

/** In-flight jobs get this long to finish once SIGTERM arrives; then pg-boss fails them to retry. */
export const JOB_DRAIN_TIMEOUT_MS = 20_000;

/**
 * The process exits by this deadline whatever is still hanging. It sits inside the 30s an
 * orchestrator gives a container between SIGTERM and SIGKILL (set `stop_grace_period: 30s` /
 * `terminationGracePeriodSeconds: 30` where the default is lower).
 */
export const SHUTDOWN_DEADLINE_MS = 28_000;

interface Stoppable {
  stop(): Promise<void>;
}

export interface ShutdownParts {
  readonly boss: Pick<PgBoss, 'stop'>;
  readonly outboxPump: Stoppable;
  readonly queueMonitor: Stoppable;
  readonly closeRedis: () => Promise<void>;
  readonly closeDb: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly jobDrainTimeoutMs?: number;
  readonly deadlineMs?: number;
}

/**
 * Stops the worker in the order that loses nothing:
 *
 * 1. the queue monitor and the outbox pump — no new jobs are sent once the current pass ends;
 * 2. pg-boss, gracefully: every worker loop stops fetching at once, jobs already running get
 *    `jobDrainTimeoutMs` to finish, and any still running then are failed back to `retry` (their
 *    retry is safe — idempotency is each job's own) before pg-boss closes its pool;
 * 3. Redis and the database pool, which a running job may have needed until step 2 returned.
 *
 * A step that throws is logged and the rest still run; a step that hangs is cut off by the
 * deadline, which exits non-zero.
 */
export function createShutdown(parts: ShutdownParts): (signal: string) => Promise<void> {
  const jobDrainTimeoutMs = parts.jobDrainTimeoutMs ?? JOB_DRAIN_TIMEOUT_MS;
  const deadlineMs = parts.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let started: Promise<void> | undefined;

  const step = async (name: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      return true;
    } catch (error) {
      logger.error({ err: error, step: name }, 'shutdown step failed');
      return false;
    }
  };

  return (signal) => {
    started ??= (async () => {
      logger.info({ signal, jobDrainTimeoutMs }, 'worker shutting down');
      const deadline = setTimeout(() => {
        logger.error({ deadlineMs }, 'worker shutdown overran its deadline; exiting');
        parts.exit(1);
      }, deadlineMs);
      deadline.unref();

      const results = [
        await step('queue-monitor', () => parts.queueMonitor.stop()),
        await step('outbox-pump', () => parts.outboxPump.stop()),
        await step('pg-boss', () =>
          parts.boss.stop({ graceful: true, timeout: jobDrainTimeoutMs, wait: true, close: true }),
        ),
        await step('redis', parts.closeRedis),
        await step('database', parts.closeDb),
      ];

      clearTimeout(deadline);
      const clean = results.every(Boolean);
      logger.info({ clean }, 'worker stopped');
      parts.exit(clean ? 0 : 1);
    })();
    return started;
  };
}
