import type PgBoss from 'pg-boss';

import type { JobDeps } from './deps.js';
import { pruneIdempotencyKeys } from './jobs/idempotency/prune.job.js';
import { assertLedgerBalance } from './jobs/ledger/assert-balance.job.js';
import {
  dispatchNotifications,
  type NotificationPayload,
} from './jobs/notification/dispatch.job.js';
import { relayOutbox } from './jobs/outbox/relay.job.js';

export async function registerHandlers(boss: PgBoss, deps: JobDeps): Promise<void> {
  await boss.work('outbox.relay', { pollingIntervalSeconds: 1 }, () => relayOutbox(deps));
  await boss.work<NotificationPayload>('notification.dispatch', { batchSize: 50 }, (jobs) =>
    dispatchNotifications(deps, jobs),
  );
  await boss.work('ledger.assert-balance', {}, () => assertLedgerBalance(deps));
  await boss.work('idempotency.prune', {}, () => pruneIdempotencyKeys(deps));
}
