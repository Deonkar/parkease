import type PgBoss from 'pg-boss';

import type { JobDeps } from './deps.js';
import { completeBooking } from './jobs/booking/complete.job.js';
import { expireUnpaid } from './jobs/booking/expire-unpaid.job.js';
import { remindBooking } from './jobs/booking/remind.job.js';
import { pruneIdempotencyKeys } from './jobs/idempotency/prune.job.js';
import { assertLedgerBalance } from './jobs/ledger/assert-balance.job.js';
import {
  dispatchNotifications,
  type NotificationPayload,
} from './jobs/notification/dispatch.job.js';
import { relayOutbox } from './jobs/outbox/relay.job.js';
import { issueRefund } from './jobs/payment/issue-refund.job.js';
import { reconcileOrphanCapture } from './jobs/payment/reconcile-orphan.job.js';

/**
 * Booking jobs are handled one at a time rather than in a batch: each takes a
 * FOR UPDATE row lock, and batching them would hold several at once inside a
 * single handler for no gain. Every handler is idempotent, because pg-boss
 * delivery is at-least-once (R-ASYNC-03).
 */
export async function registerHandlers(boss: PgBoss, deps: JobDeps): Promise<void> {
  await boss.work('outbox.relay', { pollingIntervalSeconds: 1 }, () => relayOutbox(deps));
  await boss.work<NotificationPayload>('notification.dispatch', { batchSize: 50 }, (jobs) =>
    dispatchNotifications(deps, jobs),
  );
  await boss.work('ledger.assert-balance', {}, () => assertLedgerBalance(deps));
  await boss.work('idempotency.prune', {}, () => pruneIdempotencyKeys(deps));

  await boss.work<unknown>('booking.expire-unpaid', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await expireUnpaid(deps, job.data);
  });
  await boss.work<unknown>('booking.complete', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await completeBooking(deps, job.data);
  });
  await boss.work<unknown>('booking.remind', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await remindBooking(deps, job.data);
  });

  // One at a time, like the booking jobs: each takes a FOR UPDATE row lock, and
  // a refund is the one thing in this system that cannot be undone if done twice.
  await boss.work<unknown>('payment.issue-refund', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await issueRefund(deps, job.data);
  });
  await boss.work<unknown>('payment.orphan-capture', { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await reconcileOrphanCapture(deps, job.data);
  });
}
