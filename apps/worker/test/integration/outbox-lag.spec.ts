import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import PgBoss from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import {
  OUTBOX_LAG_BUDGET_SECONDS,
  outboxLagSeconds,
  relayOutbox,
  startOutboxPump,
} from '../../src/jobs/outbox/relay.job.js';
import { logger } from '../../src/logger.js';
import { ensureQueues } from '../../src/queues.js';

/**
 * Task 21 §21.3 #17 and §21.4: the outbox lag budget is 30s at p95 (prd.md §12).
 *
 * Before this, the relay ran only from a once-a-minute cron and took one batch of 100 per run. A
 * single message could wait a full minute, and anything above 100 messages a minute was a backlog
 * that only grew. These run a real pg-boss, because "dispatched" means a job pg-boss created.
 */
describe('outbox lag', () => {
  let pg: PgTestContext;
  let boss: PgBoss;
  let deps: JobDeps;

  beforeAll(async () => {
    pg = await startPgContainer();
    await runMigrations(pg.connectionString);
    boss = new PgBoss({ connectionString: pg.connectionString, schema: 'pgboss' });
    boss.on('error', () => undefined);
    await boss.start();
    await ensureQueues(boss);
    deps = {
      db: drizzle(pg.sql) as unknown as JobDeps['db'],
      boss,
      redis: undefined as unknown as JobDeps['redis'],
    };
  }, 300_000);

  afterAll(async () => {
    await boss.stop({ graceful: false, wait: true });
    await stopPgContainer(pg);
  });

  beforeEach(async () => {
    await pg.sql`TRUNCATE outbox_messages`;
  });

  /** A job type with a real queue and no recipient lookup, so each message is one pg-boss send. */
  const enqueue = async (count: number, availableAgoSeconds = 0) => {
    await pg.sql`
      INSERT INTO outbox_messages (type, payload, available_at, created_at)
      SELECT 'booking.expire-unpaid',
             jsonb_build_object('bookingId', gen_random_uuid()),
             now() - make_interval(secs => ${availableAgoSeconds}),
             now() - make_interval(secs => ${availableAgoSeconds})
      FROM generate_series(1, ${count})`;
  };

  const pending = async () =>
    (
      await pg.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM outbox_messages WHERE status = 'pending'`
    )[0]?.n ?? -1;

  it('drains a backlog deeper than one batch in a single pass', async () => {
    await enqueue(250);

    const pass = await relayOutbox(deps);

    expect(pass.relayed).toBe(250);
    expect(await pending()).toBe(0);
  });

  it('reports no lag when nothing is waiting', async () => {
    await expect(outboxLagSeconds(deps)).resolves.toBe(0);
  });

  it('does not count a message held back by retry backoff as lag', async () => {
    await pg.sql`
      INSERT INTO outbox_messages (type, payload, available_at, created_at, attempts)
      VALUES ('booking.expire-unpaid', '{}'::jsonb, now() + interval '5 minutes',
              now() - interval '10 minutes', 3)`;

    await expect(outboxLagSeconds(deps)).resolves.toBe(0);
  });

  it('alerts when the oldest ready message has waited past the budget, then clears it', async () => {
    // A relay paused for 45s: the scenario's "lag alert fires during pause", seen by the first
    // pass that runs again.
    await enqueue(100, 45);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const pass = await relayOutbox(deps);

    expect(pass.lagSeconds).toBeGreaterThan(OUTBOX_LAG_BUDGET_SECONDS);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ budgetSeconds: OUTBOX_LAG_BUDGET_SECONDS }),
      expect.stringMatching(/^OUTBOX_LAG/),
    );
    expect(pass.relayed).toBe(100);
    expect(await pending()).toBe(0);

    error.mockClear();
    await expect(relayOutbox(deps)).resolves.toEqual({ relayed: 0, lagSeconds: 0 });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps enqueue-to-dispatch p95 inside the budget with the pump running', async () => {
    const pump = startOutboxPump(deps, 200);
    try {
      // Arrivals spread over ~2s, the way a burst of bookings lands, not one bulk insert.
      for (let wave = 0; wave < 10; wave += 1) {
        await enqueue(10);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await vi.waitFor(
        async () => {
          expect(await pending()).toBe(0);
        },
        { timeout: OUTBOX_LAG_BUDGET_SECONDS * 1000, interval: 100 },
      );
    } finally {
      await pump.stop();
    }

    const [row] = await pg.sql<{ p95: number; n: number }[]>`
      SELECT percentile_cont(0.95) WITHIN GROUP (
               ORDER BY extract(epoch FROM dispatched_at - created_at))::float8 AS p95,
             count(*)::int AS n
      FROM outbox_messages WHERE status = 'dispatched'`;
    expect(row?.n).toBe(100);
    // The budget is 30s; a pump at this interval should land well inside 5.
    expect(row?.p95).toBeLessThan(5);
  });

  it('stops promptly, without waiting out its interval', async () => {
    const pump = startOutboxPump(deps, 60_000);
    const started = performance.now();

    await pump.stop();

    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
