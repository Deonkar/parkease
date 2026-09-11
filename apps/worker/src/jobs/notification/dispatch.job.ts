import type PgBoss from 'pg-boss';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

export interface NotificationPayload {
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/require-await -- pg-boss WorkHandler must return Promise
export async function dispatchNotifications(
  _deps: JobDeps,
  jobs: PgBoss.Job<NotificationPayload>[],
): Promise<void> {
  for (const job of jobs) {
    logger.info(
      { userId: job.data.userId, type: job.data.type },
      'notification dispatch (no-op adapter — task 19 adds delivery)',
    );
  }
}
