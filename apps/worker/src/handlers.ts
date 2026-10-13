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
import { dispatchNotifications } from './jobs/notification/dispatch.job.js';
import {
  fetchReceipts,
  NOTIFICATION_FETCH_RECEIPTS_JOB,
} from './jobs/notification/fetch-receipts.job.js';
import { relayOutbox } from './jobs/outbox/relay.job.js';
import { issueRefund } from './jobs/payment/issue-refund.job.js';
import { PAYMENT_REVERSE_TRANSFER_JOB } from './jobs/payment/payload.js';
import { reconcileOrphanCapture } from './jobs/payment/reconcile-orphan.job.js';
import { reverseTransfer } from './jobs/payment/reverse-transfer.job.js';
import { applyPayoutStatusJob } from './jobs/payout/apply-status.job.js';
import {
  PAYOUT_APPLY_STATUS_JOB,
  PAYOUT_RECONCILE_JOB,
  PAYOUT_RUN_WEEKLY_JOB,
  PAYOUT_SEND_JOB,
} from './jobs/payout/payload.js';
import { reconcilePayouts } from './jobs/payout/reconcile.job.js';
import { runWeeklyPayouts } from './jobs/payout/run-weekly.job.js';
import { sendPayout } from './jobs/payout/send.job.js';
import {
  recomputeAgeingAggregates,
  REVIEW_RECOMPUTE_AGGREGATES_JOB,
} from './jobs/review/recompute-aggregates.job.js';
import { recalculateSurge, SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';
import { acceptTimeout } from './jobs/valet/accept-timeout.job.js';
import { noShow } from './jobs/valet/no-show.job.js';
import { logger } from './logger.js';
import { QUEUE_REGISTRY, type QueueDefinition, type QueueName, workOptions } from './queues.js';

export type JobBatch = PgBoss.JobWithMetadata<unknown>[];
export type JobHandler = (deps: JobDeps, jobs: JobBatch) => Promise<unknown>;

/** A payload job, one at a time through the batch pg-boss hands over. */
const each =
  (run: (deps: JobDeps, data: unknown) => Promise<unknown>): JobHandler =>
  async (deps, jobs) => {
    for (const job of jobs) await run(deps, job.data);
  };

/** A payload-free sweep: it works from current state, so there is nothing to pass or validate. */
const sweep =
  (run: (deps: JobDeps) => Promise<unknown>): JobHandler =>
  (deps) =>
    run(deps);

/**
 * One handler per registry queue — `satisfies` makes a registry entry without a handler, or a
 * handler without a registry entry, a compile error. Capacity (batch size, loops, polling) comes
 * from the queue's tier in `queues.ts`, not from here.
 *
 * Payload jobs are handled one at a time rather than in a batch (`batchSize: 1` on their tiers):
 * each takes a FOR UPDATE row lock, and batching would hold several at once inside one handler for
 * no gain. Every handler is idempotent, because pg-boss delivery is at-least-once (R-ASYNC-03).
 */
export const HANDLERS = {
  'outbox.relay': sweep(relayOutbox),
  // Batched: a batch of 50 pushes is one Expo call. Retrying the batch is safe (dispatch.job.ts).
  'notification.dispatch': (deps, jobs) => dispatchNotifications(deps, jobs),
  [NOTIFICATION_FETCH_RECEIPTS_JOB]: sweep(fetchReceipts),
  'ledger.assert-balance': sweep(assertLedgerBalance),
  'idempotency.prune': sweep(pruneIdempotencyKeys),
  [SURGE_RECALCULATE]: sweep(recalculateSurge),

  'booking.expire-unpaid': each(expireUnpaid),
  'booking.complete': each(completeBooking),
  'booking.remind': each(remindBooking),

  // A refund is the one thing in this system that cannot be undone if done twice; each of these
  // locks its row and checks the gateway before acting.
  'payment.issue-refund': each(issueRefund),
  'payment.orphan-capture': each(reconcileOrphanCapture),
  [PAYMENT_REVERSE_TRANSFER_JOB]: each(reverseTransfer),

  // No-show takes a row lock on valet_jobs and posts money; accept-timeout pins the status and
  // round it read in each write instead (S-18), so an accept that lands mid-search wins. The queue
  // names come from contracts, so the API's enqueue and this registration cannot drift apart.
  [VALET_ACCEPT_TIMEOUT_JOB]: each(acceptTimeout),
  [VALET_NO_SHOW_JOB]: each(noShow),

  // Two deliveries of the same carwash round racing would double-offer. Serialising redeliveries
  // does not serialise this handler against an accept arriving through the API in another
  // transaction; that race is answered where it has to be — the handler pins the status and the
  // round in its own UPDATE's WHERE, so an accept landing mid-search wins and the widening becomes
  // a logged no-op.
  [CARWASH_ACCEPT_TIMEOUT_JOB]: each(carwashAcceptTimeout),
  [CARWASH_COMPLETE_REMINDER_JOB]: each(washCompleteReminder),

  // Task 16a. The weekly run is cron-driven and payload-free; each payee it pays commits a
  // `payout.send` with its payout row. Send is the call that moves money, and a claim per row is
  // what keeps a bank change from cancelling a payout already on its way.
  [PAYOUT_RUN_WEEKLY_JOB]: sweep(runWeeklyPayouts),
  [PAYOUT_RECONCILE_JOB]: sweep(reconcilePayouts),
  [PAYOUT_SEND_JOB]: each(sendPayout),
  // S-102: a RazorpayX webhook's status, applied with the same transitions reconcile uses.
  [PAYOUT_APPLY_STATUS_JOB]: each(applyPayoutStatusJob),

  // Task 17a. Cron-driven and payload-free, like the payout run.
  [REVIEW_RECOMPUTE_AGGREGATES_JOB]: sweep(recomputeAgeingAggregates),
} satisfies Record<QueueName, JobHandler>;

export type Handlers = Readonly<Record<QueueName, JobHandler>>;

/**
 * Wraps a handler with the structured log every job gets: queue, tier, job id and attempt number.
 * A failure is rethrown so pg-boss retries it; the attempt that exhausts the retry limit logs at
 * error, since its job is about to land in the dead-letter queue.
 */
export function instrument(
  q: QueueDefinition,
  handler: JobHandler,
  deps: JobDeps,
): PgBoss.WorkWithMetadataHandler<unknown> {
  return async (jobs) => {
    const first = jobs[0];
    const context = {
      queue: q.name,
      tier: q.tier,
      ...(jobs.length === 1 ? { jobId: first?.id } : { jobIds: jobs.map((j) => j.id) }),
      attempt: Math.max(...jobs.map((j) => j.retryCount + 1)),
      retryLimit: first?.retryLimit,
    };
    const started = performance.now();
    try {
      const result = await handler(deps, jobs);
      logger.debug(
        { ...context, durationMs: Math.round(performance.now() - started) },
        'job completed',
      );
      return result;
    } catch (error) {
      const lastAttempt = jobs.some((j) => j.retryCount >= j.retryLimit);
      const failure = {
        ...context,
        err: error,
        durationMs: Math.round(performance.now() - started),
      };
      if (lastAttempt) {
        logger.error(
          { ...failure, deadLetter: q.deadLetter },
          'job failed its last attempt; it moves to the dead-letter queue',
        );
      } else {
        logger.warn(failure, 'job failed; pg-boss retries it with backoff');
      }
      throw error;
    }
  };
}

/**
 * Registers `concurrency` worker loops on every registry queue, with its tier's batch size and
 * polling interval. `handlers` is replaceable so a test can drive real pg-boss with stubs.
 */
export async function registerHandlers(
  boss: PgBoss,
  deps: JobDeps,
  handlers: Handlers = HANDLERS,
): Promise<void> {
  for (const q of QUEUE_REGISTRY) {
    const handler = instrument(q, handlers[q.name], deps);
    for (let loop = 0; loop < q.worker.concurrency; loop += 1) {
      await boss.work<unknown>(q.name, workOptions(q), handler);
    }
  }
}
