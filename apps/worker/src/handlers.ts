import { VALET_ACCEPT_TIMEOUT_JOB, VALET_NO_SHOW_JOB } from '@parkease/contracts/valet';
import {
  CARWASH_ACCEPT_TIMEOUT_JOB,
  CARWASH_COMPLETE_REMINDER_JOB,
} from '@parkease/contracts/washer';
import type PgBoss from 'pg-boss';

import type { JobDeps } from './deps.js';
import { completeBooking } from './jobs/booking/complete.job.js';
import { expireUnpaid } from './jobs/booking/expire-unpaid.job.js';
import { remindBooking } from './jobs/booking/remind.job.js';
import { acceptTimeout as carwashAcceptTimeout } from './jobs/carwash/accept-timeout.job.js';
import { washCompleteReminder } from './jobs/carwash/wash-complete-reminder.job.js';
import { pruneIdempotencyKeys } from './jobs/idempotency/prune.job.js';
import { assertLedgerBalance } from './jobs/ledger/assert-balance.job.js';
import {
  dispatchNotifications,
  type NotificationPayload,
} from './jobs/notification/dispatch.job.js';
import { relayOutbox } from './jobs/outbox/relay.job.js';
import { issueRefund } from './jobs/payment/issue-refund.job.js';
import { reconcileOrphanCapture } from './jobs/payment/reconcile-orphan.job.js';
import { recalculateSurge, SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';
import { acceptTimeout } from './jobs/valet/accept-timeout.job.js';
import { noShow } from './jobs/valet/no-show.job.js';

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

  // Cron-driven and payload-free: it recomputes every zone from current state,
  // so there is nothing for a caller to pass and nothing to validate.
  await boss.work(SURGE_RECALCULATE, {}, () => recalculateSurge(deps));

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

  // One at a time, like the booking jobs. Both take a row lock on valet_jobs,
  // and the no-show handler posts money — the one thing that must not run twice.
  // The queue names come from contracts, so the enqueue in the API and the work
  // registration here cannot drift into a job nobody picks up.
  await boss.work<unknown>(VALET_ACCEPT_TIMEOUT_JOB, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await acceptTimeout(deps, job.data);
  });
  await boss.work<unknown>(VALET_NO_SHOW_JOB, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await noShow(deps, job.data);
  });

  // One at a time, for the same reason as valet's: two deliveries of the same
  // round racing each other would double-offer.
  //
  // Note what `batchSize: 1` does NOT do. It serialises redeliveries of the
  // same pg-boss job; it does not serialise this handler against an accept
  // arriving through the API in a different transaction. That race is answered
  // where it has to be — the handler pins the status and the round in its own
  // UPDATE's WHERE, so an accept landing mid-search wins and the widening
  // becomes a logged no-op.
  //
  // The queue names come from contracts, so the enqueue in the API and the
  // registration here cannot drift into a job nobody picks up.
  await boss.work<unknown>(CARWASH_ACCEPT_TIMEOUT_JOB, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await carwashAcceptTimeout(deps, job.data);
  });
  await boss.work<unknown>(CARWASH_COMPLETE_REMINDER_JOB, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await washCompleteReminder(deps, job.data);
  });
}
