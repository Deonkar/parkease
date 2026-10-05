import { VALET_ACCEPT_TIMEOUT_JOB, VALET_NO_SHOW_JOB } from '@parkease/contracts/valet';
import {
  CARWASH_ACCEPT_TIMEOUT_JOB,
  CARWASH_COMPLETE_REMINDER_JOB,
} from '@parkease/contracts/washer';
import type PgBoss from 'pg-boss';

import {
  PAYOUT_RECONCILE_JOB,
  PAYOUT_RUN_WEEKLY_JOB,
  PAYOUT_SEND_JOB,
} from './jobs/payout/payload.js';
import { SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';

/**
 * Every queue the worker works or schedules — one list, so `handlers.ts`, `schedule.ts` and the
 * outbox relay cannot disagree (S-104).
 *
 * pg-boss 10 partitions jobs by queue, and a queue exists only once `createQueue` has run:
 * `schedule()` on a missing queue throws "Queue X not found", and `send()` inserts nothing and
 * answers null **without throwing**. A name missing from this list is therefore a job that is
 * never created, silently.
 */
export const QUEUES = [
  'outbox.relay',
  'notification.dispatch',
  'ledger.assert-balance',
  'idempotency.prune',
  SURGE_RECALCULATE,
  'booking.expire-unpaid',
  'booking.complete',
  'booking.remind',
  'payment.issue-refund',
  'payment.orphan-capture',
  VALET_ACCEPT_TIMEOUT_JOB,
  VALET_NO_SHOW_JOB,
  CARWASH_ACCEPT_TIMEOUT_JOB,
  CARWASH_COMPLETE_REMINDER_JOB,
  PAYOUT_RUN_WEEKLY_JOB,
  PAYOUT_RECONCILE_JOB,
  PAYOUT_SEND_JOB,
] as const;

/**
 * Domain events the API records in the outbox that nothing consumes yet (notifications, task 19;
 * analytics). The relay marks them dispatched without creating a job: a queue with no worker would
 * only fill up. A future subscriber moves its event into `QUEUES` with a handler.
 */
export const UNSUBSCRIBED_EVENTS = [
  'booking.created',
  'booking.confirmed',
  'booking.checked-in',
  'booking.extended',
  'booking.completed',
  'booking.cancelled',
  'booking.expired',
  'payment.failed',
  'space.updated',
  'space.photos_updated',
  'space.deleted',
  'identity.session-created',
  'valet.offer-withdrawn',
  'carwash.offer-withdrawn',
] as const;

const JOBS: ReadonlySet<string> = new Set(QUEUES);
const EVENTS: ReadonlySet<string> = new Set(UNSUBSCRIBED_EVENTS);

/**
 * How the relay treats an outbox message: a job to send, an event nobody subscribes to yet, or a
 * type nobody registered — which pg-boss would accept as null and lose without a word.
 */
export function outboxRoute(type: string): 'job' | 'event' | 'unknown' {
  if (JOBS.has(type)) return 'job';
  if (EVENTS.has(type)) return 'event';
  return 'unknown';
}

/**
 * Creates every queue before anything works, schedules or sends. Idempotent — pg-boss's
 * `create_queue` is `ON CONFLICT DO NOTHING` — so it runs on every boot. Queue-level options stay
 * at their defaults; the retry options each `send` passes still apply per job.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of QUEUES) {
    await boss.createQueue(name);
  }
}
