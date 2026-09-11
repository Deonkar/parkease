import PgBoss from 'pg-boss';

import { env } from './config/env.js';
import { registerHandlers } from './handlers.js';
import { logger } from './logger.js';
import { registerSchedule } from './schedule.js';

const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  schema: 'pgboss',
  retryLimit: 3,
  retryBackoff: true,
});

boss.on('error', (error: Error) => {
  logger.error({ err: error }, 'pg-boss error');
});

await boss.start();
await registerHandlers(boss);
await registerSchedule(boss);

logger.info({ schema: 'pgboss' }, 'worker started');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void boss.stop({ graceful: true }).then(() => {
      process.exit(0);
    });
  });
}
