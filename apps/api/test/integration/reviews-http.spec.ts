import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutboxService } from '../../src/platform/outbox/outbox.service.js';

import {
  type Harness,
  seedBooking,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  truncateSpaces,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

interface Envelope {
  readonly data?: unknown;
  readonly meta?: { hasMore: boolean; nextCursor: string | null };
  readonly error?: { readonly code: string; readonly message: string };
}

const env = (response: { body: unknown }): Envelope => response.body as Envelope;
const data = <T = Record<string, unknown>>(response: { body: unknown }): T =>
  env(response).data as T;
const codeOf = (response: { body: unknown }): string | undefined => env(response).error?.code;

const ORIGIN = { lat: 12.9352, lng: 77.6245 };

/**
 * The twelve review endpoints (task 17 §17.9) through the real Fastify pipeline: interceptors,
 * guards, the exception filter, the envelope. A test that calls a command cannot see any of them.
 */
describe('reviews HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let adminId: string;
  let otherOwnerId: string;
  let otherDriverId: string;
  let valetId: string;
  let washerA: string;
  let washerB: string;
  let spaceId: string;
  let bookingId: string;

  const as = (id: string, role: string) => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };
  const asDriver = () => as(h.driverId, 'driver');
  const asOwner = () => as(h.ownerId, 'owner');
  const asAdmin = () => as(adminId, 'admin');

  const get = (url: string) => http.request({ method: 'GET', url });
  const post = (url: string, payload: unknown, key: string | null = crypto.randomUUID()) =>
    http.request({
      method: 'POST',
      url,
      payload,
      headers: key === null ? {} : { 'idempotency-key': key },
    });

  const reviewSpace = (rating: number, extra: Record<string, unknown> = {}) =>
    post('/api/v1/driver/reviews', {
      bookingId,
      targetType: 'space',
      targetId: spaceId,
      rating,
      ...extra,
    });

  async function readModel(table: string, column: string, id: string) {
    const [row] = await h.sql<{ avg: number | null; count: number }[]>`
      SELECT rating_avg_bp AS avg, rating_count AS count
      FROM ${h.sql(table)} WHERE ${h.sql(column)} = ${id}`;
    return row;
  }

  async function seedPartnerProfiles(): Promise<void> {
    await h.sql`
      INSERT INTO valet_profiles (user_id, verification_status, rating_count)
      VALUES (${valetId}, 'verified', 0)`;
    for (const washer of [washerA, washerB]) {
      await h.sql`
        INSERT INTO washer_profiles (user_id, partner_type, verification_status, rating_count)
        VALUES (${washer}, 'gig', 'verified', 0)`;
    }
  }

  /** A completed booking with a completed valet job and two completed washes by two washers. */
  async function seedCompletedBooking(completedDaysAgo = 1): Promise<string> {
    const id = await seedBooking(h, {
      spaceId,
      vehicleType: 'car',
      slotIndex: 0,
      slotStatus: 'released',
      startsInMinutes: -600,
      endsInMinutes: -300,
    });
    await h.sql`
      UPDATE bookings
      SET status = 'completed', completed_at = now() - make_interval(secs => ${completedDaysAgo * 86_400})
      WHERE id = ${id}`;
    await h.sql`
      INSERT INTO valet_jobs (booking_id, driver_user_id, assigned_user_id, status,
                              pickup_location, pickup_address, commission_rate)
      VALUES (${id}, ${h.driverId}, ${valetId}, 'completed',
              ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
              'Forum Mall', 0.200)`;
    for (const [washer, n] of [
      [washerA, 1],
      [washerB, 2],
    ] as const) {
      await h.sql`
        INSERT INTO wash_jobs (booking_id, driver_user_id, washer_user_id, status, service_name,
                               vehicle_type, price_paise, commission_rate, txn_id, space_location,
                               before_photo_id, after_photo_id)
        VALUES (${id}, ${h.driverId}, ${washer}, 'completed', 'basic_exterior', 'car', 30000, 0.150,
                ${crypto.randomUUID()},
                ST_SetSRID(ST_MakePoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
                ${`before-${String(n)}-${id}`}, ${`after-${String(n)}-${id}`})`;
    }
    return id;
  }

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    adminId = await seedUser(h, 'admin');
    otherOwnerId = await seedUser(h, 'owner');
    otherDriverId = await seedUser(h, 'driver');
    valetId = await seedUser(h, 'valet');
    washerA = await seedUser(h, 'washer');
    washerB = await seedUser(h, 'washer');
    await h.sql`UPDATE users SET name = 'Ravi Kumar' WHERE id = ${h.driverId}`;
  });

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE review_reports, reviews, wash_jobs, valet_jobs, valet_profiles,
                         washer_profiles, audit_log, outbox_messages, idempotency_keys CASCADE`;
    await truncateSpaces(h);
    spaceId = await seedSpace(h, { ...ORIGIN, title: 'Basement Parking, 5th Cross' });
    await seedPartnerProfiles();
    bookingId = await seedCompletedBooking();
    vi.restoreAllMocks();
    asDriver();
  });

  describe('a driver reviewing a booking', () => {
    it('writes the review and the read model, and space detail shows both', async () => {
      const response = await reviewSpace(4, { comment: 'Easy to find, gate was open.' });

      expect(response.status).toBe(201);
      expect(data(response)).toMatchObject({
        rating: 4,
        targetType: 'space',
        reviewerName: 'Ravi K.',
      });
      expect(await readModel('spaces', 'id', spaceId)).toEqual({ avg: 40_000, count: 1 });

      const detail = data<{
        badge: unknown;
        reviewSummary: { distribution: Record<string, number> };
        recentReviews: unknown[];
      }>(await get(`/api/v1/driver/spaces/${spaceId}`));
      expect(detail.badge).toEqual({ kind: 'rated', stars: '4.0', reviewCount: 1 });
      expect(detail.reviewSummary.distribution['4']).toBe(1);
      expect(detail.recentReviews).toHaveLength(1);
    });

    it('allows a second wash review on the same booking', async () => {
      const wash = (targetId: string) =>
        post('/api/v1/driver/reviews', { bookingId, targetType: 'washer', targetId, rating: 5 });

      expect((await wash(washerA)).status).toBe(201);
      expect((await wash(washerB)).status).toBe(201);

      const again = await wash(washerA);
      expect(again.status).toBe(409);
      expect(codeOf(again)).toBe('REVIEW_ALREADY_EXISTS');
      expect(await readModel('washer_profiles', 'user_id', washerA)).toEqual({
        avg: 50_000,
        count: 1,
      });
    });

    it('rates the valet into the read model dispatch reads', async () => {
      const response = await post('/api/v1/driver/reviews', {
        bookingId,
        targetType: 'valet',
        targetId: valetId,
        rating: 3,
      });
      expect(response.status).toBe(201);
      expect(await readModel('valet_profiles', 'user_id', valetId)).toEqual({
        avg: 30_000,
        count: 1,
      });
    });

    it('commits nothing when the transaction fails after the insert', async () => {
      vi.spyOn(http.app.get(OutboxService), 'enqueue').mockRejectedValueOnce(new Error('boom'));

      expect((await reviewSpace(5)).status).toBe(500);

      const [row] = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM reviews`;
      expect(row?.n).toBe(0);
      expect(await readModel('spaces', 'id', spaceId)).toEqual({ avg: null, count: 0 });
    });

    it('refuses a booking that has not finished', async () => {
      await h.sql`UPDATE bookings SET status = 'active', completed_at = NULL WHERE id = ${bookingId}`;
      const response = await reviewSpace(4);
      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('BOOKING_NOT_COMPLETED');
    });

    it('closes the window seven days after completion', async () => {
      bookingId = await seedCompletedBooking(8);
      const response = await reviewSpace(4);
      expect(response.status).toBe(409);
      expect(codeOf(response)).toBe('REVIEW_WINDOW_CLOSED');
    });

    it('answers 404 to a driver who was not on the booking', async () => {
      as(otherDriverId, 'driver');
      expect((await reviewSpace(4)).status).toBe(404);
    });

    it('validates the stars and the idempotency key', async () => {
      const half = await reviewSpace(4.5);
      expect(half.status).toBe(400);
      expect(codeOf(half)).toBe('VALIDATION_FAILED');

      const noKey = await post(
        '/api/v1/driver/reviews',
        { bookingId, targetType: 'space', targetId: spaceId, rating: 4 },
        null,
      );
      expect(noKey.status).toBe(400);
    });

    it('replays a retried key and refuses a changed body under it', async () => {
      const key = crypto.randomUUID();
      const body = { bookingId, targetType: 'space', targetId: spaceId, rating: 4 };
      const first = await post('/api/v1/driver/reviews', body, key);
      await vi.waitFor(async () => {
        const [row] = await h.sql<{ status: number | null }[]>`
          SELECT response_status AS status FROM idempotency_keys WHERE key = ${key}`;
        expect(row?.status).not.toBeNull();
      });

      expect(data(await post('/api/v1/driver/reviews', body, key))).toEqual(data(first));
      expect((await post('/api/v1/driver/reviews', { ...body, rating: 2 }, key)).status).toBe(422);
    });

    it('stores an injection payload verbatim and returns it byte for byte', async () => {
      const comment = "'); DROP TABLE reviews; --";
      expect((await reviewSpace(3, { comment })).status).toBe(201);

      const mine = data<{ comment: string }[]>(await get('/api/v1/driver/reviews'));
      expect(mine[0]?.comment).toBe(comment);
    });

    it('lists what is still reviewable, and drops a booking past its window', async () => {
      await reviewSpace(5);
      await seedCompletedBooking(8);

      const pending = data<
        { bookingId: string; targets: { targetType: string; reviewed: boolean }[] }[]
      >(await get('/api/v1/driver/reviews/pending'));

      expect(pending.map((p) => p.bookingId)).toEqual([bookingId]);
      expect(pending[0]?.targets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetType: 'space', reviewed: true }),
          expect.objectContaining({ targetType: 'valet', reviewed: false }),
        ]),
      );
      expect(pending[0]?.targets.filter((t) => t.targetType === 'washer')).toHaveLength(2);
    });

    it('pages its own reviews to the end through nextCursor', async () => {
      await reviewSpace(5);
      for (const targetId of [washerA, washerB]) {
        await post('/api/v1/driver/reviews', {
          bookingId,
          targetType: 'washer',
          targetId,
          rating: 4,
        });
      }

      const seen: string[] = [];
      let url = '/api/v1/driver/reviews?limit=1';
      for (;;) {
        const page = await get(url);
        seen.push(...data<{ id: string }[]>(page).map((r) => r.id));
        const next = env(page).meta?.nextCursor;
        if (next == null) break;
        url = `/api/v1/driver/reviews?limit=1&cursor=${next}`;
      }
      expect(new Set(seen).size).toBe(3);
    });
  });

  describe('reporting', () => {
    let reviewId: string;

    beforeEach(async () => {
      reviewId = data<{ id: string }>(await reviewSpace(1, { comment: 'spam link' })).id;
    });

    it('flags without hiding, once per reporter, and from the owner too', async () => {
      as(otherDriverId, 'driver');
      const first = await post(`/api/v1/driver/reviews/${reviewId}/report`, {
        reason: 'spam_or_fake',
      });
      expect(first.status).toBe(201);

      const detail = data<{ recentReviews: Record<string, unknown>[] }>(
        await get(`/api/v1/driver/spaces/${spaceId}`),
      );
      // Still public, and the flag is not: any account could otherwise brand any review.
      expect(detail.recentReviews.map((r) => r['id'])).toEqual([reviewId]);
      expect(detail.recentReviews[0]).not.toHaveProperty('isReported');
      const [flag] = await h.sql<{ reported: boolean }[]>`
        SELECT is_reported AS reported FROM reviews WHERE id = ${reviewId}`;
      expect(flag?.reported).toBe(true);

      const again = await post(`/api/v1/driver/reviews/${reviewId}/report`, { reason: 'other' });
      expect(again.status).toBe(409);
      expect(codeOf(again)).toBe('REVIEW_ALREADY_REPORTED');

      asOwner();
      expect(
        (await post(`/api/v1/owner/reviews/${reviewId}/report`, { reason: 'irrelevant' })).status,
      ).toBe(201);

      as(otherOwnerId, 'owner');
      expect(
        (await post(`/api/v1/owner/reviews/${reviewId}/report`, { reason: 'other' })).status,
      ).toBe(404);
    });

    it("answers 404 to a driver reporting a review that is not of a space — it isn't public", async () => {
      asOwner();
      const ofDriver = data<{ id: string }>(
        await post('/api/v1/owner/reviews', { bookingId, rating: 2 }),
      ).id;

      as(otherDriverId, 'driver');
      expect(
        (await post(`/api/v1/driver/reviews/${ofDriver}/report`, { reason: 'other' })).status,
      ).toBe(404);
    });
  });

  describe('the owner', () => {
    let reviewId: string;

    beforeEach(async () => {
      reviewId = data<{ id: string }>(await reviewSpace(4)).id;
      asOwner();
    });

    it('reads reviews of their own spaces, and nobody else can', async () => {
      const mine = await get(`/api/v1/owner/reviews?spaceId=${spaceId}`);
      expect(data<{ id: string }[]>(mine).map((r) => r.id)).toEqual([reviewId]);

      as(otherOwnerId, 'owner');
      expect(data<unknown[]>(await get('/api/v1/owner/reviews'))).toEqual([]);
      expect((await get(`/api/v1/owner/reviews?spaceId=${spaceId}`)).status).toBe(404);
    });

    it('responds once; a second response and a stranger are refused', async () => {
      const ok = await post(`/api/v1/owner/reviews/${reviewId}/respond`, {
        response: 'Thanks Ravi!',
      });
      expect(ok.status).toBe(200);
      expect(data(ok)).toMatchObject({ ownerResponse: 'Thanks Ravi!' });

      const again = await post(`/api/v1/owner/reviews/${reviewId}/respond`, { response: 'Again' });
      expect(again.status).toBe(409);
      expect(codeOf(again)).toBe('RESPONSE_ALREADY_EXISTS');

      as(otherOwnerId, 'owner');
      expect(
        (await post(`/api/v1/owner/reviews/${reviewId}/respond`, { response: 'Mine' })).status,
      ).toBe(404);
    });

    it('refuses a response that is only invisible characters', async () => {
      const blank = await post(`/api/v1/owner/reviews/${reviewId}/respond`, {
        response: '​‮',
      });
      expect(blank.status).toBe(400);
      expect(codeOf(blank)).toBe('RESPONSE_EMPTY');
    });

    it('reviews the driver once', async () => {
      const first = await post('/api/v1/owner/reviews', { bookingId, rating: 5 });
      expect(first.status).toBe(201);
      expect(data(first)).toMatchObject({ targetType: 'driver', targetId: h.driverId });

      expect((await post('/api/v1/owner/reviews', { bookingId, rating: 4 })).status).toBe(409);

      as(otherOwnerId, 'owner');
      expect((await post('/api/v1/owner/reviews', { bookingId, rating: 1 })).status).toBe(404);
    });

    it('summarises each space, with bars that sum to the count', async () => {
      const summary = data<
        { spaceId: string; ratingCount: number; distribution: Record<string, number> }[]
      >(await get('/api/v1/owner/reviews/summary'));

      const space = summary.find((s) => s.spaceId === spaceId);
      expect(space?.ratingCount).toBe(1);
      expect(Object.values(space?.distribution ?? {}).reduce((a, b) => a + b, 0)).toBe(1);
    });
  });

  describe('moderation', () => {
    it('queues reported reviews; remove recomputes and audits; dismiss keeps the average', async () => {
      for (const rating of [5, 5, 5]) {
        const reviewer = await seedUser(h, 'driver');
        await h.sql`
          INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id, rating)
          VALUES (${bookingId}, ${reviewer}, 'driver', 'space', ${spaceId}, ${rating})`;
      }
      const oneStar = data<{ id: string }>(await reviewSpace(1)).id;
      expect(await readModel('spaces', 'id', spaceId)).toEqual({ avg: 40_000, count: 4 });

      as(otherDriverId, 'driver');
      await post(`/api/v1/driver/reviews/${oneStar}/report`, { reason: 'spam_or_fake' });
      asOwner();
      await post(`/api/v1/owner/reviews/${oneStar}/report`, { reason: 'irrelevant' });

      expect((await get('/api/v1/admin/moderation/reviews')).status).toBe(403);

      asAdmin();
      const queue = data<{ id: string; reports: unknown[] }[]>(
        await get('/api/v1/admin/moderation/reviews'),
      );
      expect(queue).toEqual([expect.objectContaining({ id: oneStar })]);
      expect(queue[0]?.reports).toHaveLength(2);

      const removed = await post(`/api/v1/admin/moderation/reviews/${oneStar}/remove`, {
        reason: 'spam_or_fake',
      });
      expect(removed.status).toBe(200);
      expect(data(removed)).toMatchObject({ moderationStatus: 'removed' });
      expect(await readModel('spaces', 'id', spaceId)).toEqual({ avg: 50_000, count: 3 });

      const [audit] = await h.sql<{ action: string; actor: string; before: { rating: number } }[]>`
        SELECT action, actor_user_id AS actor, before FROM audit_log WHERE target_id = ${oneStar}`;
      expect(audit).toMatchObject({
        action: 'review.remove',
        actor: adminId,
        before: { rating: 1 },
      });

      asDriver();
      const detail = data<{ recentReviews: { id: string }[] }>(
        await get(`/api/v1/driver/spaces/${spaceId}`),
      );
      expect(detail.recentReviews.map((r) => r.id)).not.toContain(oneStar);
      asAdmin();

      expect(
        (await post(`/api/v1/admin/moderation/reviews/${oneStar}/remove`, { reason: 'x' })).status,
      ).toBe(409);

      // Dismiss: a reported 5★ stays, the flag clears, the average does not move.
      const [kept] = await h.sql<{ id: string }[]>`
        UPDATE reviews SET is_reported = true
        WHERE id = (SELECT id FROM reviews WHERE deleted_at IS NULL LIMIT 1) RETURNING id`;
      const dismissed = await post(`/api/v1/admin/moderation/reviews/${kept!.id}/dismiss`, {});
      expect(dismissed.status).toBe(200);
      expect(data(dismissed)).toMatchObject({ isReported: false, moderationStatus: 'visible' });
      expect(await readModel('spaces', 'id', spaceId)).toEqual({ avg: 50_000, count: 3 });
      const [dismissAudit] = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE target_id = ${kept!.id} AND action = 'review.dismiss'`;
      expect(dismissAudit?.n).toBe(1);
    });

    it('serves the queue from the partial index', async () => {
      const reviewer = await seedUser(h, 'driver');
      await h.sql`
        INSERT INTO reviews (booking_id, reviewer_user_id, reviewer_role, target_type, target_id, rating)
        SELECT ${bookingId}, ${reviewer}, 'driver', 'space', gen_random_uuid(), 4
        FROM generate_series(1, 2000)`;
      await h.sql`ANALYZE reviews`;

      const plan = await h.sql<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT * FROM reviews WHERE is_reported AND deleted_at IS NULL ORDER BY id LIMIT 21`;
      expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('reviews_moderation_queue_idx');
    });
  });
});
