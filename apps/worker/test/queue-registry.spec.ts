import type PgBoss from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { HANDLERS, instrument, registerHandlers } from '../src/handlers.js';
import { logger } from '../src/logger.js';
import { evaluateQueueHealth, type QueueDepth } from '../src/monitor.js';
import {
  DEAD_LETTER_QUEUES,
  deadLetterQueueOptions,
  outboxRoute,
  QUEUE_REGISTRY,
  queueDefinition,
  queueOptions,
  QUEUES,
  relaySendOptions,
  retryWindowSeconds,
  TIER_ORDER,
  TIERS,
  UNSUBSCRIBED_EVENTS,
  workOptions,
} from '../src/queues.js';
import { registerSchedule } from '../src/schedule.js';
import { createShutdown } from '../src/shutdown.js';

const MONEY = /^(payment|payout|ledger)\./;

const scheduledQueues = async (): Promise<string[]> => {
  const names: string[] = [];
  await registerSchedule({
    schedule: vi.fn(async (name: string) => {
      names.push(name);
    }),
  } as never);
  return names;
};

describe('queue registry', () => {
  it('names each queue once, and no queue is also an unsubscribed event', () => {
    expect(new Set(QUEUES).size).toBe(QUEUES.length);
    for (const event of UNSUBSCRIBED_EVENTS) expect(QUEUES).not.toContain(event);
  });

  it('gives every queue its own dead-letter queue, which is never itself a job or an event', () => {
    expect(new Set(DEAD_LETTER_QUEUES).size).toBe(QUEUES.length);
    for (const q of QUEUE_REGISTRY) {
      expect(q.deadLetter, q.name).toBe(`${q.name}.dlq`);
      expect(queueOptions(q).deadLetter).toBe(q.deadLetter);
      // A dead letter waits for a human: it is not retried, and has no dead letter of its own.
      expect(deadLetterQueueOptions(q)).not.toHaveProperty('deadLetter');
      expect(deadLetterQueueOptions(q).retryLimit).toBe(0);
      expect(outboxRoute(q.deadLetter)).toBe('unknown');
    }
  });

  it('has a handler for every queue and a queue for every handler', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...QUEUES].sort());
  });

  it('registers each queue with its tier capacity and metadata for the job log', async () => {
    const calls: { name: string; options: PgBoss.WorkOptions }[] = [];
    await registerHandlers(
      {
        work: vi.fn(async (name: string, options: PgBoss.WorkOptions) => {
          calls.push({ name, options });
          return name;
        }),
      } as never,
      {} as never,
    );
    for (const q of QUEUE_REGISTRY) {
      const mine = calls.filter((c) => c.name === q.name);
      expect(mine, q.name).toHaveLength(q.worker.concurrency);
      for (const call of mine) expect(call.options).toEqual(workOptions(q));
      expect(workOptions(q).includeMetadata).toBe(true);
    }
  });

  it('cron queues are exactly the scheduled ones, and are stately sweeps', async () => {
    const scheduled = await scheduledQueues();
    const cron = QUEUE_REGISTRY.filter((q) => q.trigger === 'cron').map((q) => q.name);
    expect([...scheduled].sort()).toEqual([...cron].sort());
    for (const q of QUEUE_REGISTRY) {
      expect(q.policy, q.name).toBe(q.trigger === 'cron' ? 'stately' : 'standard');
      if (q.policy === 'stately') expect(q.worker).toMatchObject({ concurrency: 1, batchSize: 1 });
    }
  });

  it('puts every money queue in the critical tier, at the highest priority there is', () => {
    const top = Math.max(...QUEUE_REGISTRY.map((q) => q.priority));
    const money = QUEUE_REGISTRY.filter((q) => MONEY.test(q.name));
    expect(money.map((q) => q.name)).toEqual(
      expect.arrayContaining([
        'payment.issue-refund',
        'payment.reverse-transfer',
        'payment.orphan-capture',
        'payout.send',
        'payout.apply-status',
        'payout.run-weekly',
        'payout.reconcile',
        'ledger.assert-balance',
      ]),
    );
    for (const q of money) {
      expect(q.tier, q.name).toBe('critical');
      expect(q.priority, q.name).toBe(top);
    }
  });

  it('puts the marketplace timers in the time-critical tier', () => {
    for (const name of [
      'booking.expire-unpaid',
      'booking.complete',
      'booking.remind',
      'valet.accept-timeout',
      'valet.no-show',
      'carwash.accept-timeout',
    ]) {
      expect(queueDefinition(name).tier, name).toBe('time-critical');
    }
  });

  it('orders tiers strictly: priority falls, SLO loosens, capacity never favours housekeeping', () => {
    for (let i = 1; i < TIER_ORDER.length; i += 1) {
      const higher = TIERS[TIER_ORDER[i - 1] ?? 'critical'];
      const lower = TIERS[TIER_ORDER[i] ?? 'housekeeping'];
      expect(higher.priority).toBeGreaterThan(lower.priority);
      expect(higher.worker.pollingIntervalSeconds).toBeLessThanOrEqual(
        lower.worker.pollingIntervalSeconds,
      );
    }
    const { housekeeping } = TIERS;
    expect(housekeeping.worker).toEqual({
      concurrency: 1,
      batchSize: 1,
      pollingIntervalSeconds: expect.any(Number) as number,
    });
    for (const tier of ['critical', 'time-critical'] as const) {
      expect(TIERS[tier].worker.pollingIntervalSeconds).toBeLessThanOrEqual(1);
      expect(TIERS[tier].worker.concurrency).toBeGreaterThan(housekeeping.worker.concurrency);
      expect(TIERS[tier].slo.maxWaitSeconds).toBeLessThan(housekeeping.slo.maxWaitSeconds);
    }
  });

  it('retries with exponential backoff inside pg-boss limits, over a span that fits the tier', () => {
    for (const q of QUEUE_REGISTRY) {
      expect(q.retryBackoff, q.name).toBe(true);
      expect(q.retryLimit, q.name).toBeGreaterThanOrEqual(1);
      expect(q.retryDelaySeconds, q.name).toBeGreaterThanOrEqual(1);
      // pg-boss refuses an expiry of 24h or more; a job must also finish well inside retention.
      expect(q.expireInSeconds, q.name).toBeLessThan(24 * 3600);
      expect(q.retentionDays, q.name).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(q.retryDelaySeconds), q.name).toBe(true);
    }
    // Money rides out a gateway outage of an hour or more before a human is called.
    for (const q of QUEUE_REGISTRY.filter((d) => MONEY.test(d.name) && d.trigger === 'outbox')) {
      expect(retryWindowSeconds(q).min, q.name).toBeGreaterThanOrEqual(3600);
    }
    // A marketplace timer that is still failing after 15 minutes has failed its user already.
    for (const q of QUEUE_REGISTRY.filter((d) => d.tier === 'time-critical')) {
      expect(retryWindowSeconds(q).max, q.name).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('documents why a retry is safe in every tier (R-ASYNC-03)', () => {
    for (const tier of TIER_ORDER) expect(TIERS[tier].retrySafety.length).toBeGreaterThan(40);
  });

  it('sends with the outbox message id, the tier priority and the natural key', () => {
    const messageId = '0190a6b4-0000-7000-8000-000000000001';
    const refundId = '0190a6b4-0000-7000-8000-000000000002';
    expect(relaySendOptions('payment.issue-refund', messageId, { refundId })).toEqual({
      id: messageId,
      priority: TIERS.critical.priority,
      singletonKey: refundId,
    });
    expect(relaySendOptions('booking.complete', messageId, { bookingId: 'b-1' })).toMatchObject({
      priority: TIERS['time-critical'].priority,
      singletonKey: 'b-1',
    });
    // No natural key in the payload (or none declared): the message id keys it.
    expect(relaySendOptions('booking.complete', messageId, {}).singletonKey).toBe(messageId);
    expect(relaySendOptions('notification.dispatch', messageId, { userId: 'u' })).toEqual({
      id: messageId,
      priority: TIERS.notification.priority,
      singletonKey: messageId,
    });
    // Retry options live on the queue, so every path that sends gets the same ones.
    expect(relaySendOptions('payout.send', messageId, {})).not.toHaveProperty('retryLimit');
  });

  it('stores retention in minutes, the unit pg-boss 10.1.5 createQueue actually reads', () => {
    const q = queueDefinition('payment.issue-refund');
    expect(queueOptions(q)).toMatchObject({ retentionMinutes: q.retentionDays * 24 * 60 });
    expect(queueOptions(q)).not.toHaveProperty('retentionDays');
  });
});

describe('queue monitor evaluation', () => {
  const depth = (name: string, d: Partial<QueueDepth> = {}): QueueDepth => ({
    name,
    waiting: 0,
    ready: 0,
    oldestReadySeconds: 0,
    oldestCreatedSeconds: 0,
    ...d,
  });

  it('flags a queue whose oldest ready job waited past its tier SLO, and nothing else', () => {
    const refund = queueDefinition('payment.issue-refund');
    const prune = queueDefinition('idempotency.prune');
    const health = evaluateQueueHealth([
      depth(refund.name, {
        waiting: 1,
        ready: 1,
        oldestReadySeconds: refund.slo.maxWaitSeconds + 1,
      }),
      // The same wait is fine for housekeeping.
      depth(prune.name, {
        waiting: 1,
        ready: 1,
        oldestReadySeconds: refund.slo.maxWaitSeconds + 1,
      }),
    ]);
    expect(health.breaches).toEqual([
      expect.objectContaining({ queue: refund.name, tier: 'critical' }),
    ]);
    expect(health.deadLetters).toEqual([]);
  });

  it('flags a queue holding more ready jobs than its SLO allows', () => {
    const q = queueDefinition('booking.expire-unpaid');
    const { breaches } = evaluateQueueHealth([
      depth(q.name, { waiting: 999, ready: q.slo.maxReady + 1 }),
    ]);
    expect(breaches.map((b) => b.queue)).toEqual([q.name]);
  });

  it('does not count jobs held back by a retry delay as ready', () => {
    const q = queueDefinition('payout.send');
    expect(evaluateQueueHealth([depth(q.name, { waiting: 10_000, ready: 0 })]).breaches).toEqual(
      [],
    );
  });

  it('reports any dead letter, against the queue it came from', () => {
    const q = queueDefinition('payout.send');
    const { deadLetters } = evaluateQueueHealth([
      depth(q.deadLetter, { waiting: 2, ready: 2, oldestCreatedSeconds: 90 }),
    ]);
    expect(deadLetters).toEqual([
      {
        queue: q.name,
        tier: 'critical',
        deadLetterQueue: q.deadLetter,
        count: 2,
        oldestSeconds: 90,
      },
    ]);
  });
});

describe('job instrumentation', () => {
  const job = (retryCount: number, retryLimit = 2) =>
    ({ id: 'job-1', name: 'booking.complete', data: {}, retryCount, retryLimit }) as never;

  it('logs a retryable failure at warn and the last attempt at error, then rethrows', async () => {
    const q = queueDefinition('booking.complete');
    const failing = instrument(q, () => Promise.reject(new Error('boom')), {} as never);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await expect(failing([job(0)])).rejects.toThrow('boom');
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ queue: q.name, tier: q.tier, jobId: 'job-1', attempt: 1 }),
        expect.stringMatching(/retries/),
      );
      expect(error).not.toHaveBeenCalled();

      await expect(failing([job(2)])).rejects.toThrow('boom');
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', attempt: 3, deadLetter: q.deadLetter }),
        expect.stringMatching(/dead-letter/),
      );
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('hands the handler the batch and returns its result', async () => {
    const q = queueDefinition('notification.dispatch');
    const handler = vi.fn(async () => 'done');
    const deps = { marker: true } as never;
    await expect(instrument(q, handler, deps)([job(0), job(0)])).resolves.toBe('done');
    expect(handler).toHaveBeenCalledWith(deps, [expect.anything(), expect.anything()]);
  });
});

describe('graceful shutdown', () => {
  const parts = () => {
    const order: string[] = [];
    const stopper = (name: string) => ({
      stop: vi.fn(async () => {
        order.push(name);
      }),
    });
    const boss = {
      stop: vi.fn(async () => {
        order.push('pg-boss');
      }),
    };
    return {
      order,
      boss,
      outboxPump: stopper('outbox-pump'),
      queueMonitor: stopper('queue-monitor'),
      closeRedis: vi.fn(async () => {
        order.push('redis');
      }),
      closeDb: vi.fn(async () => {
        order.push('database');
      }),
      exit: vi.fn(),
    };
  };

  it('stops sending, drains in-flight jobs gracefully, then closes connections, then exits 0', async () => {
    const p = parts();
    const shutdown = createShutdown({ ...p, jobDrainTimeoutMs: 12_000 });

    await shutdown('SIGTERM');

    expect(p.order).toEqual(['queue-monitor', 'outbox-pump', 'pg-boss', 'redis', 'database']);
    expect(p.boss.stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: 12_000,
      wait: true,
      close: true,
    });
    expect(p.exit).toHaveBeenCalledWith(0);
  });

  it('runs once however many signals arrive', async () => {
    const p = parts();
    const shutdown = createShutdown(p);
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(p.boss.stop).toHaveBeenCalledTimes(1);
  });

  it('still closes everything after a step fails, and exits non-zero', async () => {
    const p = parts();
    p.boss.stop.mockRejectedValueOnce(new Error('pool gone'));
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await createShutdown(p)('SIGTERM');
    } finally {
      error.mockRestore();
    }
    expect(p.closeRedis).toHaveBeenCalled();
    expect(p.closeDb).toHaveBeenCalled();
    expect(p.exit).toHaveBeenCalledWith(1);
  });

  it('exits non-zero at the deadline when a step hangs', async () => {
    vi.useFakeTimers();
    const p = parts();
    p.boss.stop.mockImplementation(() => new Promise<void>(() => undefined));
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      void createShutdown({ ...p, deadlineMs: 5_000 })('SIGTERM');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(p.exit).toHaveBeenCalledWith(1);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });
});
