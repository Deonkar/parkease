import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

const TOKEN = 'ExponentPushToken[abcdefghij0123456789]';

/**
 * `/me/notifications` and `/me/push-tokens` through the real Fastify pipeline (task 19a).
 * Delivery is the worker's and is tested there; this is the read side and the token registry.
 */
describe('/me notifications over HTTP (task 19a)', () => {
  let h: Harness;
  let http: HttpApp;
  let driver: string;
  let owner: string;

  const as = (id: string, role: string) => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };
  const get = (url: string) => http.request({ method: 'GET', url });
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    http.request({
      method,
      url,
      payload: payload ?? {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });

  async function seedFeed(userId: string, n: number, template = 'booking.confirmed') {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [row] = await h.sql<{ id: string }[]>`
        INSERT INTO notifications (user_id, type, category, title, body, deep_link)
        VALUES (${userId}, ${template}, 'bookings', ${`title ${String(i)}`}, 'body', '/(driver)/bookings')
        RETURNING id`;
      ids.push(row?.id ?? '');
    }
    return ids;
  }

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE notifications, push_receipts, push_tokens, notification_preferences, idempotency_keys`;
    driver = await seedUser(h, 'driver');
    owner = await seedUser(h, 'owner');
    as(driver, 'driver');
  });

  describe('feed', () => {
    it("returns the caller's notifications only", async () => {
      await seedFeed(driver, 2);
      await seedFeed(owner, 3);

      const mine = await get('/api/v1/me/notifications');
      expect(mine.status).toBe(200);
      expect((mine.body as { data: unknown[] }).data).toHaveLength(2);

      as(owner, 'owner');
      expect(
        ((await get('/api/v1/me/notifications')).body as { data: unknown[] }).data,
      ).toHaveLength(3);
    });

    it('pages by cursor, newest first: 25 rows, 10 + 10 + 5', async () => {
      await seedFeed(driver, 25);
      const titles: string[] = [];
      let cursor: string | null = null;
      const sizes: number[] = [];

      for (let page = 0; page < 3; page++) {
        const url: string = `/api/v1/me/notifications?limit=10${cursor === null ? '' : `&cursor=${cursor}`}`;
        const res = (await get(url)).body as {
          data: { title: string }[];
          meta: { hasMore: boolean; nextCursor: string | null };
        };
        sizes.push(res.data.length);
        titles.push(...res.data.map((n) => n.title));
        cursor = res.meta.nextCursor;
        expect(res.meta.hasMore).toBe(page < 2);
      }

      expect(sizes).toEqual([10, 10, 5]);
      expect(cursor).toBeNull();
      expect(titles[0]).toBe('title 24');
      expect(titles.at(-1)).toBe('title 0');
    });

    it('shapes a row for the app: category, link, no template internals', async () => {
      await seedFeed(driver, 1);
      const [item] = (
        (await get('/api/v1/me/notifications')).body as { data: Record<string, unknown>[] }
      ).data;
      expect(item).toMatchObject({
        category: 'bookings',
        actionable: false,
        deepLink: '/(driver)/bookings',
        isRead: false,
      });
      expect(item).not.toHaveProperty('type');
      expect(item).not.toHaveProperty('dedupeKey');
    });
  });

  describe('read state', () => {
    it('counts unread, marks one read idempotently, and keeps the first read_at', async () => {
      const [first] = await seedFeed(driver, 3);
      const count = async () =>
        ((await get('/api/v1/me/notifications/unread-count')).body as { data: { count: number } })
          .data.count;
      expect(await count()).toBe(3);

      expect((await send('POST', `/api/v1/me/notifications/${first}/read`)).status).toBe(204);
      const [{ read_at: readAt }] = await h.sql<{ read_at: Date }[]>`
        SELECT read_at FROM notifications WHERE id = ${first ?? ''}`.then(
        (r) => r as { read_at: Date }[],
      );
      expect(await count()).toBe(2);

      expect((await send('POST', `/api/v1/me/notifications/${first}/read`)).status).toBe(204);
      const [again] = await h.sql<
        { read_at: Date }[]
      >`SELECT read_at FROM notifications WHERE id = ${first ?? ''}`;
      expect(again?.read_at).toEqual(readAt);
    });

    it("another user's notification is a 404, and stays unread", async () => {
      const [theirs] = await seedFeed(owner, 1);

      const res = await send('POST', `/api/v1/me/notifications/${theirs}/read`);

      expect(res.status).toBe(404);
      const [row] = await h.sql<
        { is_read: boolean }[]
      >`SELECT is_read FROM notifications WHERE id = ${theirs ?? ''}`;
      expect(row?.is_read).toBe(false);
    });

    it("read-all marks the caller's rows and leaves everyone else's", async () => {
      await seedFeed(driver, 3);
      await seedFeed(owner, 2);

      expect((await send('POST', '/api/v1/me/notifications/read-all')).status).toBe(204);

      const rows = await h.sql<{ user_id: string; unread: number }[]>`
        SELECT user_id, count(*) FILTER (WHERE NOT is_read)::int AS unread
        FROM notifications GROUP BY user_id`;
      expect(rows.find((r) => r.user_id === driver)?.unread).toBe(0);
      expect(rows.find((r) => r.user_id === owner)?.unread).toBe(2);
    });
  });

  describe('preferences', () => {
    const prefs = async () =>
      (
        (await get('/api/v1/me/notifications/preferences')).body as {
          data: { category: string; pushEnabled: boolean; inAppEnabled: boolean }[];
        }
      ).data;

    it('a new user gets the defaults: promotions off, the rest on, and no row written', async () => {
      const all = await prefs();

      expect(all).toHaveLength(9);
      expect(all.find((p) => p.category === 'promotions')).toEqual({
        category: 'promotions',
        pushEnabled: false,
        inAppEnabled: true,
      });
      expect(all.filter((p) => p.category !== 'promotions').every((p) => p.pushEnabled)).toBe(true);
      expect(await h.sql`SELECT 1 FROM notification_preferences`).toHaveLength(0);
    });

    it('an update changes only what it names and reads back', async () => {
      await send('PUT', '/api/v1/me/notifications/preferences', {
        preferences: [{ category: 'promotions', pushEnabled: true }],
      });
      await send('PUT', '/api/v1/me/notifications/preferences', {
        preferences: [{ category: 'bookings', pushEnabled: false }],
      });

      const all = await prefs();
      expect(all.find((p) => p.category === 'promotions')?.pushEnabled).toBe(true);
      expect(all.find((p) => p.category === 'bookings')).toMatchObject({
        pushEnabled: false,
        inAppEnabled: true,
      });
      expect(all.find((p) => p.category === 'valet')?.pushEnabled).toBe(true);
    });

    it('rejects an unknown category', async () => {
      const res = await send('PUT', '/api/v1/me/notifications/preferences', {
        preferences: [{ category: 'spam', pushEnabled: true }],
      });
      expect(res.status).toBe(400);
    });
  });

  describe('push tokens', () => {
    const tokens = () =>
      h.sql<{ user_id: string; is_active: boolean }[]>`SELECT user_id, is_active FROM push_tokens`;

    it('registering the same token twice is one row', async () => {
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      expect(await tokens()).toHaveLength(1);
    });

    it('the same token for another user moves it', async () => {
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      as(owner, 'owner');
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });

      expect(await tokens()).toEqual([{ user_id: owner, is_active: true }]);
    });

    it('deactivating keeps the row; registering again revives it', async () => {
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      expect((await send('DELETE', '/api/v1/me/push-tokens', { token: TOKEN })).status).toBe(204);
      expect(await tokens()).toEqual([{ user_id: driver, is_active: false }]);

      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      expect(await tokens()).toEqual([{ user_id: driver, is_active: true }]);
    });

    it("cannot deactivate someone else's token", async () => {
      await send('POST', '/api/v1/me/push-tokens', { token: TOKEN, platform: 'android' });
      as(owner, 'owner');
      await send('DELETE', '/api/v1/me/push-tokens', { token: TOKEN });
      expect(await tokens()).toEqual([{ user_id: driver, is_active: true }]);
    });

    it('rejects a string that is not an Expo token', async () => {
      const res = await send('POST', '/api/v1/me/push-tokens', {
        token: 'not-a-token',
        platform: 'android',
      });
      expect(res.status).toBe(400);
    });
  });
});
