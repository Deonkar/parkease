import {
  type PgTestContext,
  runMigrations,
  startPgContainer,
  stopPgContainer,
} from '@parkease/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobDeps } from '../../src/deps.js';
import { dispatchNotifications } from '../../src/jobs/notification/dispatch.job.js';
import type {
  PushGateway,
  PushMessage,
  PushReceipt,
  PushTicket,
} from '../../src/jobs/notification/expo.js';
import { fetchReceipts } from '../../src/jobs/notification/fetch-receipts.job.js';
import { logger } from '../../src/logger.js';

let pg: PgTestContext;
let deps: JobDeps;

let seq = 0;
async function seedUser(status = 'active'): Promise<string> {
  seq += 1;
  const [row] = await pg.sql<{ id: string }[]>`
    INSERT INTO users (phone, firebase_uid, name, status)
    VALUES (${`+9197${String(10_000_000 + seq)}`}, ${`fb-n-${String(seq)}-${String(Math.random())}`},
            ${`user ${String(seq)}`}, ${status})
    RETURNING id`;
  if (row === undefined) throw new Error('seed user');
  return row.id;
}

async function seedTokens(userId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [row] = await pg.sql<{ id: string }[]>`
      INSERT INTO push_tokens (user_id, token, platform)
      VALUES (${userId}, ${`ExponentPushToken[${userId.slice(0, 8)}-${String(i)}]`}, 'android')
      RETURNING id`;
    ids.push(row?.id ?? '');
  }
  return ids;
}

/** A gateway that answers every message ok, except where `failAt` says otherwise. */
function gateway(failAt: Record<number, string> = {}): PushGateway & { sent: PushMessage[][] } {
  const sent: PushMessage[][] = [];
  return {
    sent,
    send: vi.fn((messages: readonly PushMessage[]) => {
      sent.push([...messages]);
      return Promise.resolve(
        messages.map<PushTicket>((_, i) =>
          failAt[i] === undefined
            ? { status: 'ok', id: `ticket-${String(sent.length)}-${String(i)}` }
            : { status: 'error', error: failAt[i], message: failAt[i] },
        ),
      );
    }),
    receipts: vi.fn(() => Promise.resolve({})),
  };
}

const job = (id: string, userId: string, template = 'booking.confirmed') => ({
  id,
  name: 'notification.dispatch',
  data: { userId, template, data: { bookingId: '0192f1c0-0000-7000-8000-000000000001' } },
});

const feed = (userId: string) =>
  pg.sql<{ title: string; category: string; deep_link: string | null }[]>`
    SELECT title, category, deep_link FROM notifications WHERE user_id = ${userId}`;

beforeAll(async () => {
  pg = await startPgContainer();
  await runMigrations(pg.connectionString);
  deps = {
    db: drizzle(pg.sql) as unknown as JobDeps['db'],
    boss: {} as JobDeps['boss'],
    redis: {} as JobDeps['redis'],
  };
}, 300_000);

afterAll(async () => {
  await stopPgContainer(pg);
});

beforeEach(async () => {
  await pg.sql`TRUNCATE notifications, push_receipts, push_tokens, notification_preferences, users CASCADE`;
  vi.clearAllMocks();
});

describe('notification.dispatch', () => {
  it('persists the in-app row, pushes once, and stores the ticket', async () => {
    const user = await seedUser();
    await seedTokens(user, 1);
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user)] as never, push);

    expect(await feed(user)).toEqual([
      expect.objectContaining({ title: 'Booking confirmed', category: 'bookings' }),
    ]);
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.sent[0]?.[0]?.channelId).toBe('bookings');
    const receipts = await pg.sql`SELECT ticket_id FROM push_receipts`;
    expect(receipts).toHaveLength(1);
  });

  it('push off still writes the in-app row and sends nothing', async () => {
    const user = await seedUser();
    await seedTokens(user, 1);
    await pg.sql`INSERT INTO notification_preferences (user_id, preferences)
                 VALUES (${user}, ${JSON.stringify({ bookings: { push: false } })}::jsonb)`;
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user)] as never, push);

    expect(await feed(user)).toHaveLength(1);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('in-app off still pushes and writes no row', async () => {
    const user = await seedUser();
    await seedTokens(user, 1);
    await pg.sql`INSERT INTO notification_preferences (user_id, preferences)
                 VALUES (${user}, ${JSON.stringify({ bookings: { inApp: false } })}::jsonb)`;
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user)] as never, push);

    expect(await feed(user)).toHaveLength(0);
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('promotions are off until the user opts in', async () => {
    // No promotions template exists yet, so assert the default through the catalog.
    const { DEFAULT_PUSH_ENABLED } = await import('@parkease/contracts/shared');
    expect(DEFAULT_PUSH_ENABLED.promotions).toBe(false);
  });

  it.each(['blocked', 'deleted'])('a %s user gets nothing', async (status) => {
    const user = await seedUser(status);
    await seedTokens(user, 1);
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user)] as never, push);

    expect(await feed(user)).toHaveLength(0);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('no active token: no push, in-app row kept', async () => {
    const user = await seedUser();
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user)] as never, push);

    expect(await feed(user)).toHaveLength(1);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('deactivates the token Expo flagged, not its neighbour, past the 100 boundary', async () => {
    const user = await seedUser();
    const ids = await seedTokens(user, 150);
    const first = gateway({ 119: 'DeviceNotRegistered' });
    await dispatchNotifications(deps, [job('j1', user)] as never, first);

    const dead = await pg.sql<{ id: string; token: string }[]>`
      SELECT id, token FROM push_tokens WHERE user_id = ${user} AND NOT is_active`;
    expect(dead).toHaveLength(1);
    expect(first.sent[0]?.[119]?.to).toBe(dead[0]?.token);
    expect(ids).toContain(dead[0]?.id);
    expect(first.sent[0]).toHaveLength(150);
  });

  it('is idempotent on the job id: a redelivery sends nothing and adds no row', async () => {
    const user = await seedUser();
    await seedTokens(user, 1);
    const push = gateway();

    await dispatchNotifications(deps, [job('same-job', user)] as never, push);
    await dispatchNotifications(deps, [job('same-job', user)] as never, push);

    expect(await feed(user)).toHaveLength(1);
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('a failed send un-writes the row so the retry delivers the push', async () => {
    const user = await seedUser();
    await seedTokens(user, 1);
    const broken: PushGateway = {
      send: () => Promise.reject(new Error('expo down')),
      receipts: () => Promise.resolve({}),
    };
    await expect(dispatchNotifications(deps, [job('j1', user)] as never, broken)).rejects.toThrow();
    expect(await feed(user)).toHaveLength(0);

    const push = gateway();
    await dispatchNotifications(deps, [job('j1', user)] as never, push);
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(await feed(user)).toHaveLength(1);
  });

  it('drops an unknown template loudly instead of retrying it', async () => {
    const user = await seedUser();
    const warn = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const push = gateway();

    await dispatchNotifications(deps, [job('j1', user, 'nope.nothing')] as never, push);

    expect(warn).toHaveBeenCalled();
    expect(await feed(user)).toHaveLength(0);
  });
});

describe('notification.fetch-receipts', () => {
  async function pendingTicket(
    tokenId: string,
    ticketId: string,
    minutesAgo: number,
  ): Promise<void> {
    await pg.sql`INSERT INTO push_receipts (ticket_id, token_id, created_at)
                 VALUES (${ticketId}, ${tokenId}, now() - make_interval(mins => ${minutesAgo}))`;
  }
  const withReceipts = (r: Record<string, PushReceipt>): PushGateway => ({
    send: () => Promise.resolve([]),
    receipts: vi.fn(() => Promise.resolve(r)),
  });

  it('a DeviceNotRegistered receipt deactivates its own token; ok closes the ticket', async () => {
    const user = await seedUser();
    const [a, b] = await seedTokens(user, 2);
    await pendingTicket(a ?? '', 't-a', 20);
    await pendingTicket(b ?? '', 't-b', 20);

    await fetchReceipts(
      deps,
      withReceipts({
        't-a': { status: 'error', error: 'DeviceNotRegistered', message: 'gone' },
        't-b': { status: 'ok' },
      }),
    );

    const tokens = await pg.sql<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM push_tokens`;
    expect(tokens.find((t) => t.id === a)?.is_active).toBe(false);
    expect(tokens.find((t) => t.id === b)?.is_active).toBe(true);
    const open = await pg.sql`SELECT 1 FROM push_receipts WHERE processed_at IS NULL`;
    expect(open).toHaveLength(0);
  });

  it('leaves a recent ticket alone and a receipt Expo has not produced for the next run', async () => {
    const user = await seedUser();
    const [a, b] = await seedTokens(user, 2);
    await pendingTicket(a ?? '', 't-new', 5);
    await pendingTicket(b ?? '', 't-missing', 20);
    const gw = withReceipts({});

    await fetchReceipts(deps, gw);

    expect(gw.receipts).toHaveBeenCalledWith(['t-missing']);
    const open = await pg.sql`SELECT 1 FROM push_receipts WHERE processed_at IS NULL`;
    expect(open).toHaveLength(2);
  });

  it('closes a ticket older than Expo keeps receipts, with a warning', async () => {
    const user = await seedUser();
    const [a] = await seedTokens(user, 1);
    await pendingTicket(a ?? '', 't-old', 60 * 25);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await fetchReceipts(deps, withReceipts({}));

    expect(warn).toHaveBeenCalled();
    const open = await pg.sql`SELECT 1 FROM push_receipts WHERE processed_at IS NULL`;
    expect(open).toHaveLength(0);
  });
});
