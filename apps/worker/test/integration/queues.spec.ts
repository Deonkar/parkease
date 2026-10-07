import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import PgBoss from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { registerHandlers } from '../../src/handlers.js';
import { MAX_ATTEMPTS, relayOutbox } from '../../src/jobs/outbox/relay.job.js';
import { ensureQueues, QUEUES } from '../../src/queues.js';
import { registerSchedule } from '../../src/schedule.js';

/**
 * S-104: the first test anywhere that runs a real pg-boss. Every other worker spec hands its jobs
 * a stub `boss`, which is how a worker that could not schedule a single job — and a relay that
 * dropped every message into a queue that did not exist — went unnoticed since task 4.
 *
 * pg-boss 10 partitions jobs by queue: `schedule()` throws "Queue X not found", and `send()` to a
 * missing queue inserts nothing and returns null without throwing.
 */
describe('pg-boss queues (S-104)', () => {
  let pg: PgTestContext;
  let boss: PgBoss;
  let deps: JobDeps;
  const bossErrors = vi.fn();

  beforeAll(async () => {
    pg = await startPgContainer();
    await runMigrations(pg.connectionString);
    boss = new PgBoss({ connectionString: pg.connectionString, schema: 'pgboss' });
    boss.on('error', bossErrors);
    await boss.start();
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

  it('creates every queue the worker uses, and doing it again changes nothing', async () => {
    await ensureQueues(boss);
    await ensureQueues(boss);

    // pg-boss keeps internal queues of its own (`__pgboss__send-it`); ours are the rest.
    const created = (await boss.getQueues())
      .map((q) => q.name)
      .filter((name) => !name.startsWith('__pgboss__'))
      .sort();
    expect(created).toEqual([...QUEUES].sort());
  });

  it('registers every handler and every schedule against real queues', async () => {
    await ensureQueues(boss);

    await expect(registerSchedule(boss)).resolves.toBeUndefined();
    // Registration only: the handlers are stopped straight away so they never run on {} deps.
    await expect(registerHandlers(boss, {} as never)).resolves.toBeUndefined();
    for (const name of QUEUES) await boss.offWork(name);
  });

  it('accepts a job on every queue: send answers an id, never null', async () => {
    await ensureQueues(boss);

    for (const name of QUEUES) {
      expect(await boss.send(name, {}), name).toEqual(expect.any(String));
    }
  });

  it('relays a known message type into a real job', async () => {
    await ensureQueues(boss);
    const [message] = await pg.sql<{ id: string }[]>`
      INSERT INTO outbox_messages (type, payload)
      VALUES ('booking.expire-unpaid', ${JSON.stringify({ bookingId: crypto.randomUUID() })}::jsonb)
      RETURNING id`;

    await relayOutbox(deps);

    const [row] = await pg.sql<{ status: string }[]>`
      SELECT status FROM outbox_messages WHERE id = ${message?.id ?? ''}`;
    expect(row?.status).toBe('dispatched');
    const jobs = await pg.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name = 'booking.expire-unpaid' AND singleton_key = ${message?.id ?? ''}`;
    expect(jobs).toEqual([{ n: 1 }]);
  });

  it('turns a domain event that tells someone something into a notification job (task 19)', async () => {
    await ensureQueues(boss);
    const driverId = crypto.randomUUID();
    const [message] = await pg.sql<{ id: string }[]>`
      INSERT INTO outbox_messages (type, payload)
      VALUES ('booking.confirmed', ${JSON.stringify({ bookingId: 'b1', driverId })}::jsonb)
      RETURNING id`;

    await relayOutbox(deps);

    const [job] = await pg.sql<{ data: { userId: string; template: string } }[]>`
      SELECT data FROM pgboss.job
      WHERE name = 'notification.dispatch' AND singleton_key = ${message?.id ?? ''}`;
    expect(job?.data).toMatchObject({ userId: driverId, template: 'booking.confirmed' });
  });

  it('settles an event with no recipient without a job, and does not retry it', async () => {
    const [message] = await pg.sql<{ id: string }[]>`
      INSERT INTO outbox_messages (type, payload)
      VALUES ('space.approved', '{}'::jsonb) RETURNING id`;

    await relayOutbox(deps);

    const [row] = await pg.sql<{ status: string }[]>`
      SELECT status FROM outbox_messages WHERE id = ${message?.id ?? ''}`;
    expect(row?.status).toBe('dispatched');
  });

  it('settles a domain event nobody subscribes to yet, without creating a job', async () => {
    const [message] = await pg.sql<{ id: string }[]>`
      INSERT INTO outbox_messages (type, payload)
      VALUES ('booking.extended', '{}'::jsonb)
      RETURNING id`;

    await relayOutbox(deps);

    const [row] = await pg.sql<{ status: string }[]>`
      SELECT status FROM outbox_messages WHERE id = ${message?.id ?? ''}`;
    expect(row?.status).toBe('dispatched');
    expect(
      await pg.sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'booking.extended'`,
    ).toEqual([{ n: 0 }]);
  });

  const outboxRow = async (id: string) =>
    (
      await pg.sql<{ status: string; attempts: number; last_error: string | null }[]>`
        SELECT status, attempts, last_error FROM outbox_messages WHERE id = ${id}`
    )[0];
  const enqueue = async (type: string, attempts = 0) =>
    (
      await pg.sql<{ id: string }[]>`
        INSERT INTO outbox_messages (type, payload, attempts)
        VALUES (${type}, '{}'::jsonb, ${attempts}) RETURNING id`
    )[0]?.id ?? '';

  it('never marks an unknown type dispatched: it retries, then fails loudly at the limit', async () => {
    const fresh = await enqueue('no.such.queue');
    const lastTry = await enqueue('no.such.queue.either', MAX_ATTEMPTS - 1);

    await relayOutbox(deps);

    expect(await outboxRow(fresh)).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await outboxRow(fresh))?.last_error).toMatch(/no queue for message type no.such.queue/);
    expect(await outboxRow(lastTry)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('never marks a job dispatched when pg-boss created none (its queue is gone)', async () => {
    await ensureQueues(boss);
    // An earlier test left a job in it; a queue that still holds jobs cannot be deleted.
    await boss.purgeQueue('booking.remind');
    await boss.deleteQueue('booking.remind');
    try {
      const id = await enqueue('booking.remind');

      await relayOutbox(deps);

      expect(await outboxRow(id)).toMatchObject({ status: 'pending', attempts: 1 });
      expect((await outboxRow(id))?.last_error).toMatch(/created no job for booking.remind/);
    } finally {
      await ensureQueues(boss);
    }
  });

  it('treats a duplicate send of a job that already landed as dispatched', async () => {
    await ensureQueues(boss);
    const id = await enqueue('booking.complete');
    // The job landed on an earlier relay whose transaction then rolled back.
    await boss.send('booking.complete', {}, { singletonKey: id });

    await relayOutbox(deps);

    expect(await outboxRow(id)).toMatchObject({ status: 'dispatched' });
  });
});
