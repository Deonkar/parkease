import { db } from '@parkease/db';
import PgBoss from 'pg-boss';

import { env } from './config/env.js';
import { closeRedis, type JobDeps, redisClient } from './deps.js';
import { registerHandlers } from './handlers.js';
import { startOutboxPump } from './jobs/outbox/relay.job.js';
import { logger } from './logger.js';
import { startQueueMonitor } from './monitor.js';
import { ensureQueues, PGBOSS_SCHEMA } from './queues.js';
import { registerSchedule } from './schedule.js';
import { createShutdown } from './shutdown.js';

// Retry, expiry, retention and dead-lettering are set per queue from the registry (queues.ts), so
// nothing here: a constructor default would only apply to a queue the registry forgot.
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: PGBOSS_SCHEMA });

boss.on('error', (error: Error & { queue?: string; worker?: string }) => {
  logger.error({ err: error, queue: error.queue, worker: error.worker }, 'pg-boss error');
});

await boss.start();

const deps: JobDeps = { db, boss, redis: redisClient() };

// Before anything works, schedules or sends: pg-boss 10 rejects a schedule on a missing queue and
// silently drops a job sent to one (S-104).
await ensureQueues(boss);
await registerHandlers(boss, deps);
await registerSchedule(boss);
// The outbox lag budget is 30s (prd.md §12) and cron ticks once a minute, so the relay also runs
// in-process every second. The `outbox.relay` cron job stays as the safety net.
const outboxPump = startOutboxPump(deps);
// Queue depth and age against each tier's SLO, and any dead letter (QUEUE_SLO, DEAD_LETTER).
const queueMonitor = startQueueMonitor(deps);

logger.info({ schema: PGBOSS_SCHEMA }, 'worker started');

const shutdown = createShutdown({
  boss,
  outboxPump,
  queueMonitor,
  closeRedis,
  closeDb: () => db.$client.end({ timeout: 5 }),
  exit: (code) => process.exit(code),
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
