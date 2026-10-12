import { VALET_ACCEPT_TIMEOUT_JOB, VALET_NO_SHOW_JOB } from '@parkease/contracts/valet';
import {
  CARWASH_ACCEPT_TIMEOUT_JOB,
  CARWASH_COMPLETE_REMINDER_JOB,
} from '@parkease/contracts/washer';
import type PgBoss from 'pg-boss';

import { NOTIFICATION_FETCH_RECEIPTS_JOB } from './jobs/notification/fetch-receipts.job.js';
import { PAYMENT_REVERSE_TRANSFER_JOB } from './jobs/payment/payload.js';
import {
  PAYOUT_APPLY_STATUS_JOB,
  PAYOUT_RECONCILE_JOB,
  PAYOUT_RUN_WEEKLY_JOB,
  PAYOUT_SEND_JOB,
} from './jobs/payout/payload.js';
import { REVIEW_RECOMPUTE_AGGREGATES_JOB } from './jobs/review/recompute-aggregates.job.js';
import { SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';
import { logger } from './logger.js';

/** The schema pg-boss keeps its tables in. Raw SQL against `pgboss.job` assumes this name. */
export const PGBOSS_SCHEMA = 'pgboss';

/**
 * The tier a queue belongs to decides everything pg-boss does with its jobs: how often a worker
 * looks, how many run at once, how hard a failure is retried, how long a job may run, how long it
 * is kept, and how long it may wait before the queue monitor calls it late. The worker README
 * holds the ADR.
 *
 * - `critical`      money moves or the ledger is checked; plus the outbox relay that feeds them.
 * - `time-critical` marketplace timers someone is waiting on (expiry, accept timeouts, no-show).
 * - `notification`  user-facing pushes: late is bad, lost is worse, neither touches money.
 * - `housekeeping`  recomputable sweeps: the next run repairs anything a missed one left.
 */
export type QueueTier = 'critical' | 'time-critical' | 'notification' | 'housekeeping';

/** Highest first. */
export const TIER_ORDER: readonly QueueTier[] = [
  'critical',
  'time-critical',
  'notification',
  'housekeeping',
];

/**
 * The pg-boss 10 queue policies this worker uses.
 *
 * - `standard` for payload jobs. Two jobs for one entity are kept apart by the job's own row lock
 *   or status-pinned write (R-ASYNC-03), not by the queue: under pg-boss `singleton`, a fetch that
 *   would activate a second job for a key fails as a whole, which stalls the head of the queue for
 *   every other entity behind it.
 * - `stately` for payload-free cron sweeps: at most one queued, one retrying and one running. A
 *   worker that was down for an hour finds one `outbox.relay` waiting, not sixty, and a second
 *   `payout.run-weekly` cannot start while one is still paying.
 */
export type QueuePolicy = 'standard' | 'stately';

/** What creates a queue's jobs: the outbox relay (one job per message) or a pg-boss cron. */
export type QueueTrigger = 'outbox' | 'cron';

/**
 * Worker capacity per process. pg-boss 10.1 has no local-concurrency option, so `concurrency` is
 * the number of `work()` loops registered on the queue; each fetches up to `batchSize` jobs, runs
 * them, then waits out what is left of `pollingIntervalSeconds` before fetching again.
 */
export interface WorkerCapacity {
  readonly concurrency: number;
  readonly batchSize: number;
  readonly pollingIntervalSeconds: number;
}

/** What the queue monitor holds a queue to. Breaching either logs `QUEUE_SLO` at warn. */
export interface QueueSlo {
  /** Jobs ready to run (not held back by a retry delay) the queue may hold. */
  readonly maxReady: number;
  /** Seconds the oldest ready job may have waited. */
  readonly maxWaitSeconds: number;
}

export interface TierPolicy {
  /**
   * pg-boss orders a fetch by `priority desc, created_on`. Jobs are partitioned per queue, so this
   * orders jobs within a queue — a relayed or re-driven job of a higher tier is fetched ahead of a
   * lower-tier backlog — and stamps the tier on every relayed job row. Isolation BETWEEN queues
   * comes from each queue having its own partition and its own worker loops (`worker`).
   */
  readonly priority: number;
  readonly retryLimit: number;
  /** The n-th retry waits [d·2^(n-1), d·2^n) seconds: pg-boss's jittered exponential backoff. */
  readonly retryDelaySeconds: number;
  readonly retryBackoff: true;
  /** A job running longer is failed (and retried): pg-boss races the handler against this. */
  readonly expireInSeconds: number;
  /** A job not started within this is dropped by maintenance; a dead letter is kept twice as long. */
  readonly retentionDays: number;
  readonly worker: WorkerCapacity;
  readonly slo: QueueSlo;
  /** Why redelivering a job of this tier is safe. Idempotency is each job's own (R-ASYNC-03). */
  readonly retrySafety: string;
}

export const TIERS: Readonly<Record<QueueTier, TierPolicy>> = {
  critical: {
    priority: 30,
    // 2–4h of retries: long enough to ride out a gateway outage, short enough that a refund or
    // payout still stuck after it reaches a human the same day.
    retryLimit: 8,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionDays: 30,
    worker: { concurrency: 2, batchSize: 1, pollingIntervalSeconds: 1 },
    slo: { maxReady: 50, maxWaitSeconds: 120 },
    retrySafety:
      'Every money job locks or claims its row before acting and asks the gateway under an ' +
      'idempotency key (refund id, payout id) before calling it again, so a redelivery after a ' +
      'crash finds the work done and does nothing. Ledger first, money second: a failed attempt ' +
      'leaves money owed and recorded, never moved and unrecorded.',
  },
  'time-critical': {
    priority: 20,
    // 2.5–5min: a timer acted on later than that has already failed the person waiting on it;
    // better a dead letter and an alert than a silent half-hour retry loop.
    retryLimit: 5,
    retryDelaySeconds: 5,
    retryBackoff: true,
    expireInSeconds: 120,
    retentionDays: 14,
    worker: { concurrency: 2, batchSize: 1, pollingIntervalSeconds: 1 },
    slo: { maxReady: 200, maxWaitSeconds: 30 },
    retrySafety:
      'Each handler re-reads its booking or dispatch row FOR UPDATE, or pins the status and round ' +
      'it read in its UPDATE ... WHERE, so a redelivered timer whose moment has passed (an accept ' +
      'landed, the booking was paid) is a logged no-op.',
  },
  notification: {
    priority: 10,
    retryLimit: 4,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 180,
    retentionDays: 7,
    worker: { concurrency: 1, batchSize: 50, pollingIntervalSeconds: 2 },
    slo: { maxReady: 2000, maxWaitSeconds: 300 },
    retrySafety:
      'The in-app row carries the pg-boss job id (the outbox message id) as its dedupe key, so a ' +
      'redelivered batch conflicts on what already finished and sends only what never left ' +
      '(the push-only gap is noted in dispatch.job.ts).',
  },
  housekeeping: {
    priority: 0,
    retryLimit: 2,
    retryDelaySeconds: 60,
    retryBackoff: true,
    expireInSeconds: 900,
    retentionDays: 3,
    // One loop, one job, a slow poll: a sweep holds at most one pg-boss and one database
    // connection, so it can never take the capacity the tiers above need.
    worker: { concurrency: 1, batchSize: 1, pollingIntervalSeconds: 15 },
    slo: { maxReady: 5, maxWaitSeconds: 1800 },
    retrySafety:
      'Sweeps recompute from current state (surge, review aggregates) or delete by age ' +
      '(idempotency keys): running one twice leaves what running it once does.',
  },
};

interface QueueSpec {
  readonly name: string;
  readonly tier: QueueTier;
  readonly trigger: QueueTrigger;
  /**
   * The payload field naming the entity a job acts on. The relay sends its value as the pg-boss
   * `singletonKey`, so every job for one booking or payout can be found by it.
   */
  readonly naturalKey?: string;
  readonly overrides?: Partial<
    Pick<TierPolicy, 'retryLimit' | 'retryDelaySeconds' | 'expireInSeconds'>
  >;
}

/**
 * Every queue the worker works or schedules — one registry, so `handlers.ts`, `schedule.ts` and
 * the outbox relay cannot disagree (S-104).
 *
 * pg-boss 10 partitions jobs by queue, and a queue exists only once `createQueue` has run:
 * `schedule()` on a missing queue throws "Queue X not found", and `send()` inserts nothing and
 * answers null **without throwing**. A name missing from this registry is therefore a job that is
 * never created, silently.
 *
 * Adding a queue: a spec here, a handler in `handlers.ts` (it does not compile without one) and,
 * for a cron sweep, its schedule in `schedule.ts`. The worker README has the checklist.
 */
const SPECS = [
  // The pipe every outbox-driven job travels through: if it stalls, so does money. Its own retry
  // is short because the next tick (and the in-process pump) runs it again anyway.
  {
    name: 'outbox.relay',
    tier: 'critical',
    trigger: 'cron',
    overrides: { retryLimit: 2, retryDelaySeconds: 5, expireInSeconds: 60 },
  },
  { name: 'ledger.assert-balance', tier: 'critical', trigger: 'cron' },
  { name: 'payment.issue-refund', tier: 'critical', trigger: 'outbox', naturalKey: 'refundId' },
  {
    name: 'payment.orphan-capture',
    tier: 'critical',
    trigger: 'outbox',
    naturalKey: 'paymentId',
  },
  {
    name: PAYMENT_REVERSE_TRANSFER_JOB,
    tier: 'critical',
    trigger: 'outbox',
    naturalKey: 'refundId',
  },
  // Both call RazorpayX for every payee or every payout in flight: minutes, not seconds.
  {
    name: PAYOUT_RUN_WEEKLY_JOB,
    tier: 'critical',
    trigger: 'cron',
    overrides: { expireInSeconds: 1800 },
  },
  {
    name: PAYOUT_RECONCILE_JOB,
    tier: 'critical',
    trigger: 'cron',
    overrides: { expireInSeconds: 1800 },
  },
  { name: PAYOUT_SEND_JOB, tier: 'critical', trigger: 'outbox', naturalKey: 'payoutId' },
  // Throws until the send has recorded the RazorpayX payout id (S-102); the money tier's hours of
  // backoff are what let a webhook that outran the send catch up.
  {
    name: PAYOUT_APPLY_STATUS_JOB,
    tier: 'critical',
    trigger: 'outbox',
    naturalKey: 'razorpayPayoutId',
  },

  {
    name: 'booking.expire-unpaid',
    tier: 'time-critical',
    trigger: 'outbox',
    naturalKey: 'bookingId',
  },
  { name: 'booking.complete', tier: 'time-critical', trigger: 'outbox', naturalKey: 'bookingId' },
  { name: 'booking.remind', tier: 'time-critical', trigger: 'outbox', naturalKey: 'bookingId' },
  {
    name: VALET_ACCEPT_TIMEOUT_JOB,
    tier: 'time-critical',
    trigger: 'outbox',
    naturalKey: 'jobId',
  },
  { name: VALET_NO_SHOW_JOB, tier: 'time-critical', trigger: 'outbox', naturalKey: 'jobId' },
  {
    name: CARWASH_ACCEPT_TIMEOUT_JOB,
    tier: 'time-critical',
    trigger: 'outbox',
    naturalKey: 'jobId',
  },
  {
    name: CARWASH_COMPLETE_REMINDER_JOB,
    tier: 'time-critical',
    trigger: 'outbox',
    naturalKey: 'jobId',
  },

  { name: 'notification.dispatch', tier: 'notification', trigger: 'outbox' },
  { name: NOTIFICATION_FETCH_RECEIPTS_JOB, tier: 'notification', trigger: 'cron' },

  // The 600s surge TTL is sized against a 5-minute cycle: a run still going at 4 minutes is stuck.
  {
    name: SURGE_RECALCULATE,
    tier: 'housekeeping',
    trigger: 'cron',
    overrides: { expireInSeconds: 240 },
  },
  { name: 'idempotency.prune', tier: 'housekeeping', trigger: 'cron' },
  { name: REVIEW_RECOMPUTE_AGGREGATES_JOB, tier: 'housekeeping', trigger: 'cron' },
] as const satisfies readonly QueueSpec[];

export type QueueName = (typeof SPECS)[number]['name'];

export interface QueueDefinition {
  readonly name: QueueName;
  readonly tier: QueueTier;
  readonly trigger: QueueTrigger;
  readonly policy: QueuePolicy;
  readonly priority: number;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: true;
  readonly expireInSeconds: number;
  readonly retentionDays: number;
  /** Where pg-boss moves a job that failed its last attempt. Every queue has one. */
  readonly deadLetter: string;
  readonly naturalKey: string | undefined;
  readonly worker: WorkerCapacity;
  readonly slo: QueueSlo;
}

export const DEAD_LETTER_SUFFIX = '.dlq';

export const deadLetterName = (queue: string): string => `${queue}${DEAD_LETTER_SUFFIX}`;

function define(spec: QueueSpec & { name: QueueName }): QueueDefinition {
  const tier = TIERS[spec.tier];
  const sweep = spec.trigger === 'cron';
  return {
    name: spec.name,
    tier: spec.tier,
    trigger: spec.trigger,
    policy: sweep ? 'stately' : 'standard',
    priority: tier.priority,
    retryLimit: spec.overrides?.retryLimit ?? tier.retryLimit,
    retryDelaySeconds: spec.overrides?.retryDelaySeconds ?? tier.retryDelaySeconds,
    retryBackoff: true,
    expireInSeconds: spec.overrides?.expireInSeconds ?? tier.expireInSeconds,
    retentionDays: tier.retentionDays,
    deadLetter: deadLetterName(spec.name),
    naturalKey: spec.naturalKey,
    // A stately queue runs one job at a time anyway, and a batch of identical sweeps is one sweep.
    worker: sweep ? { ...tier.worker, concurrency: 1, batchSize: 1 } : tier.worker,
    slo: tier.slo,
  };
}

export const QUEUE_REGISTRY: readonly QueueDefinition[] = SPECS.map((spec) => define(spec));

/** Every queue name, in registry order. */
export const QUEUES: readonly QueueName[] = QUEUE_REGISTRY.map((q) => q.name);

export const DEAD_LETTER_QUEUES: readonly string[] = QUEUE_REGISTRY.map((q) => q.deadLetter);

const BY_NAME: ReadonlyMap<string, QueueDefinition> = new Map(
  QUEUE_REGISTRY.map((q) => [q.name, q]),
);

export function queueDefinition(name: string): QueueDefinition {
  const definition = BY_NAME.get(name);
  if (definition === undefined) throw new Error(`no queue registered as ${name}`);
  return definition;
}

/**
 * The span a job's retries cover before it is dead-lettered: the n-th retry waits
 * [d·2^(n-1), d·2^n) seconds (pg-boss 10 `retryBackoff`), so all L of them [d·(2^L − 1), 2× that).
 */
export function retryWindowSeconds(q: QueueDefinition): { min: number; max: number } {
  const min = q.retryDelaySeconds * (2 ** q.retryLimit - 1);
  return { min, max: 2 * min };
}

/** The `createQueue` / `updateQueue` options for a registry queue. */
export function queueOptions(q: QueueDefinition): PgBoss.Queue {
  return {
    name: q.name,
    policy: q.policy,
    retryLimit: q.retryLimit,
    retryDelay: q.retryDelaySeconds,
    retryBackoff: q.retryBackoff,
    expireInSeconds: q.expireInSeconds,
    // Minutes, not days: pg-boss 10.1.5's createQueue reads `retentionMinutes` and silently drops
    // `retentionDays`.
    retentionMinutes: q.retentionDays * 24 * 60,
    deadLetter: q.deadLetter,
  };
}

/**
 * A dead-letter queue is never worked: what lands there waits for a human, and the queue monitor
 * raises `DEAD_LETTER` while it does. pg-boss copies the failed job's data and last error into it,
 * kept twice as long as the source queue's retention.
 */
export function deadLetterQueueOptions(q: QueueDefinition): PgBoss.Queue {
  return {
    name: q.deadLetter,
    policy: 'standard',
    retryLimit: 0,
    retentionMinutes: 2 * q.retentionDays * 24 * 60,
  };
}

/** The `work()` options for a registry queue, metadata included so logs carry the attempt. */
export function workOptions(q: QueueDefinition): PgBoss.WorkOptions & { includeMetadata: true } {
  return {
    batchSize: q.worker.batchSize,
    pollingIntervalSeconds: q.worker.pollingIntervalSeconds,
    includeMetadata: true,
  };
}

/**
 * How the relay sends one outbox message as a job.
 *
 * - `id` is the outbox message id. pg-boss inserts `ON CONFLICT DO NOTHING` on (queue, id), so a
 *   relay pass that sent and then rolled back cannot create the job twice. (`singletonKey` alone
 *   does not do that on a `standard` queue in pg-boss 10: it is unique only under a policy or a
 *   `singletonSeconds` slot.)
 * - `priority` is the queue's tier.
 * - `singletonKey` is the entity the job acts on when the payload names one, so every job for a
 *   booking or payout can be found by it; otherwise the message id.
 *
 * Retry, expiry, retention and dead-letter options are deliberately absent: they live on the queue,
 * so a job sent by any path — the relay, a job's own reschedule, a cron tick — gets the same ones.
 */
export function relaySendOptions(
  name: string,
  messageId: string,
  payload: unknown,
): PgBoss.SendOptions {
  const q = queueDefinition(name);
  const natural =
    q.naturalKey !== undefined && typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[q.naturalKey]
      : undefined;
  return {
    id: messageId,
    priority: q.priority,
    singletonKey: typeof natural === 'string' && natural.length > 0 ? natural : messageId,
  };
}

/**
 * Domain events the API records in the outbox that have no job of their own (analytics). The relay
 * marks them dispatched without creating a job: a queue with no worker would only fill up. Those
 * with an entry in `EVENT_NOTIFICATIONS` are first sent on as a `notification.dispatch` job
 * (task 19). A future subscriber moves its event into the registry with a handler.
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
  'space.submitted',
  'space.activated',
  'space.deactivated',
  'space.updated',
  'space.photos_updated',
  'space.deleted',
  // Task 18a: the owner hears about a decision in task 19.
  'space.approved',
  'space.rejected',
  'space.changes-requested',
  // Task 18a: the partner hears about a verification decision in task 19.
  'partner.verified',
  'partner.rejected',
  'identity.session-created',
  'valet.offer-withdrawn',
  'carwash.offer-withdrawn',
  // Task 17a: review notifications are task 19's.
  'review.created',
  'review.reported',
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
 * Creates every queue and its dead-letter queue before anything works, schedules or sends, and
 * brings an existing queue's options in line with the registry.
 *
 * Idempotent, so it runs on every boot. pg-boss's `create_queue` is `ON CONFLICT DO NOTHING`, which
 * is why `updateQueue` follows it: without it, a retry limit changed here would never reach a queue
 * an older deploy created. The dead-letter queue goes first — `queue.dead_letter` is a foreign key.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const q of QUEUE_REGISTRY) {
    for (const options of [deadLetterQueueOptions(q), queueOptions(q)]) {
      try {
        await boss.createQueue(options.name, options);
        await boss.updateQueue(options.name, options);
      } catch (error) {
        // Boot fails either way; the message says which queue, so it is fixable from the log.
        throw new Error(`could not create pg-boss queue ${options.name}`, { cause: error });
      }
    }
  }
  logger.info(
    { queues: QUEUE_REGISTRY.length, deadLetterQueues: DEAD_LETTER_QUEUES.length },
    'pg-boss queues ready',
  );
}
