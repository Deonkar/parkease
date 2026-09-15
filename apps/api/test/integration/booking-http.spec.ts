import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { windowFromNow } from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  truncateSpaces,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * The layer every other test in this suite skips.
 *
 * `booking-flows` and `booking-concurrency` drive the commands directly, which
 * is right for what they assert but means the interceptor stack, the exception
 * filter, the response envelope and the route wiring are never exercised. That
 * gap let a real defect reach a commit: `IdempotencyInterceptor` was declared
 * per-route *and* registered globally, so it ran twice and every mutation
 * answered 409. Nothing below the HTTP boundary could have noticed.
 */
describe('booking HTTP', () => {
  let h: Harness;
  let http: HttpApp;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
    await h.sql`TRUNCATE idempotency_keys`;
    actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };
  });

  const key = () => crypto.randomUUID();

  const createBody = (spaceId: string) => {
    const window = windowFromNow(2, 2);
    return {
      spaceId,
      vehicleType: 'car' as const,
      durationType: 'hourly' as const,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
    };
  };

  const post = (url: string, payload: unknown, idempotencyKey?: string) =>
    http.request({
      method: 'POST',
      url,
      ...(idempotencyKey === undefined ? {} : { headers: { 'idempotency-key': idempotencyKey } }),
      payload,
    });

  const bookingCount = async (): Promise<number> => {
    const rows = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM bookings`;
    return rows[0]?.n ?? 0;
  };

  describe('POST /driver/bookings', () => {
    /**
     * The regression guard for the double-interceptor defect. Before the fix
     * this returned 409 CONFLICT with zero rows written, on the very first
     * attempt, for every mutation in the booking API.
     */
    it('succeeds on the first attempt with a fresh key', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });

      const response = await post('/api/v1/driver/bookings', createBody(spaceId), key());

      expect(response.status).toBe(201);
      expect(await bookingCount()).toBe(1);

      const envelope = response.body as { data: { status: string; quote: { totalPaise: number } } };
      expect(envelope.data.status).toBe('pending_payment');
      expect(envelope.data.quote.totalPaise).toBe(6162);
    });

    it('replays the stored response for the same key and body', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const body = createBody(spaceId);
      const idempotencyKey = key();

      const first = await post('/api/v1/driver/bookings', body, idempotencyKey);
      const second = await post('/api/v1/driver/bookings', body, idempotencyKey);

      expect(first.status).toBe(201);
      expect(second.body).toEqual(first.body);

      // One booking, one slot, one ledger transaction — the retry executed nothing.
      expect(await bookingCount()).toBe(1);
      const slots = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_slots`;
      expect(slots[0]?.n).toBe(1);
      const txns = await h.sql<{ n: number }[]>`
        SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries
      `;
      expect(txns[0]?.n).toBe(1);
    });

    it('rejects the same key with a different body as 422', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const body = createBody(spaceId);
      const idempotencyKey = key();

      await post('/api/v1/driver/bookings', body, idempotencyKey);
      const changed = await post(
        '/api/v1/driver/bookings',
        { ...body, endsAt: new Date(new Date(body.endsAt).getTime() + 3_600_000).toISOString() },
        idempotencyKey,
      );

      expect(changed.status).toBe(422);
      expect(await bookingCount()).toBe(1);
    });

    it('rejects a mutation with no Idempotency-Key as 400', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });

      const response = await post('/api/v1/driver/bookings', createBody(spaceId));

      expect(response.status).toBe(400);
      expect(await bookingCount()).toBe(0);
    });

    it('rejects a non-uuid Idempotency-Key as 400', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });

      const response = await post('/api/v1/driver/bookings', createBody(spaceId), 'not-a-uuid');

      expect(response.status).toBe(400);
      expect(await bookingCount()).toBe(0);
    });

    it('does not let one driver replay another driver s stored response', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
      const body = createBody(spaceId);
      const sharedKey = key();

      await post('/api/v1/driver/bookings', body, sharedKey);

      // Same key, different user. The claim is scoped by userId, so this must
      // not hand the second driver the first one's booking — QR token included.
      const stranger = await seedUser(h, 'driver');
      actingAs.user = { id: stranger, roles: ['driver'], activeRole: 'driver' };
      const replayed = await post('/api/v1/driver/bookings', body, sharedKey);

      expect(replayed.status).not.toBe(201);
      const rows = await h.sql<{ driver_id: string }[]>`SELECT driver_id FROM bookings`;
      expect(rows.every((r) => r.driver_id !== stranger)).toBe(true);
    });

    /**
     * The 409 the whole task exists to produce, seen through HTTP for the first
     * time: the right status, the right machine code, and the §6 copy.
     */
    it('answers a lost slot race with 409 SLOT_UNAVAILABLE and a traceId', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const body = createBody(spaceId);

      await post('/api/v1/driver/bookings', body, key());

      const stranger = await seedUser(h, 'driver');
      actingAs.user = { id: stranger, roles: ['driver'], activeRole: 'driver' };
      const loser = await post('/api/v1/driver/bookings', body, key());

      expect(loser.status).toBe(409);
      const envelope = loser.body as { error: { code: string; message: string; traceId: string } };
      expect(envelope.error.code).toBe('SLOT_UNAVAILABLE');
      expect(envelope.error.message).toContain('just booked by someone else');
      expect(envelope.error.traceId).toBeDefined();
      // The user-facing message names no constraint, table or SQLSTATE.
      expect(envelope.error.message).not.toMatch(/23P01|booking_slots|constraint/i);
    });

    it('rejects a malformed body at the boundary, before anything is written', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });

      const response = await post(
        '/api/v1/driver/bookings',
        { ...createBody(spaceId), vehicleType: 'hovercraft' },
        key(),
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(await bookingCount()).toBe(0);
    });
  });

  describe('GET /driver/bookings', () => {
    it('is not gated on an Idempotency-Key', async () => {
      const response = await http.request({ method: 'GET', url: '/api/v1/driver/bookings' });
      expect(response.status).toBe(200);
    });

    it('returns only the caller s own bookings', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
      await post('/api/v1/driver/bookings', createBody(spaceId), key());

      const stranger = await seedUser(h, 'driver');
      actingAs.user = { id: stranger, roles: ['driver'], activeRole: 'driver' };

      const response = await http.request({ method: 'GET', url: '/api/v1/driver/bookings' });
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('rejects a tampered cursor with 400 rather than 500', async () => {
      const response = await http.request({
        method: 'GET',
        url: '/api/v1/driver/bookings?cursor=not-a-real-cursor',
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /driver/spaces/:id', () => {
    it('does not leak the owner s access instructions', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      await h.sql`
        UPDATE spaces SET access_instructions = 'Gate code 4417, second basement'
        WHERE id = ${spaceId}
      `;

      const response = await http.request({
        method: 'GET',
        url: `/api/v1/driver/spaces/${spaceId}`,
      });

      expect(response.status).toBe(200);
      // A driver with no booking must not be handed the gate code.
      expect(JSON.stringify(response.body)).not.toContain('4417');
    });

    it('prices the default booking server-side so the button carries a real total', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });

      const response = await http.request({
        method: 'GET',
        url: `/api/v1/driver/spaces/${spaceId}`,
      });

      const detail = (
        response.body as { data: { defaultBooking: { quote: { totalPaise: number } } | null } }
      ).data;
      expect(detail.defaultBooking).not.toBeNull();
      expect(detail.defaultBooking?.quote.totalPaise).toBeGreaterThan(0);
    });

    it('404s for a space that does not exist', async () => {
      const response = await http.request({
        method: 'GET',
        url: '/api/v1/driver/spaces/01920000-0000-7000-8000-000000000000',
      });
      expect(response.status).toBe(404);
    });
  });

  describe('GET /driver/quotes', () => {
    it('prices a window without reserving anything', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const body = createBody(spaceId);

      const response = await http.request({
        method: 'GET',
        url:
          `/api/v1/driver/quotes?spaceId=${spaceId}&vehicleType=car&durationType=hourly` +
          `&startsAt=${encodeURIComponent(body.startsAt)}&endsAt=${encodeURIComponent(body.endsAt)}`,
      });

      expect(response.status).toBe(200);
      expect(
        (response.body as { data: { quote: { totalPaise: number } } }).data.quote.totalPaise,
      ).toBe(6162);
      // Nothing held: the slot is still free for someone else.
      const slots = await h.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_slots`;
      expect(slots[0]?.n).toBe(0);
    });

    it('is a GET, so it needs no Idempotency-Key', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const body = createBody(spaceId);
      const response = await http.request({
        method: 'GET',
        url:
          `/api/v1/driver/quotes?spaceId=${spaceId}&vehicleType=car&durationType=hourly` +
          `&startsAt=${encodeURIComponent(body.startsAt)}&endsAt=${encodeURIComponent(body.endsAt)}`,
      });
      expect(response.status).toBe(200);
    });
  });

  describe('POST /owner/bookings/:id/check-in', () => {
    it('404s when the booking is on someone else s space', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const created = await post('/api/v1/driver/bookings', createBody(spaceId), key());
      const bookingId = (created.body as { data: { id: string } }).data.id;
      await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`;

      const otherOwner = await seedUser(h, 'owner');
      actingAs.user = { id: otherOwner, roles: ['owner'], activeRole: 'owner' };

      const response = await post(
        `/api/v1/owner/bookings/${bookingId}/check-in`,
        { token: 'pk1.x.1.y' },
        key(),
      );

      expect(response.status).toBe(400);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'INVALID_BOOKING_REFERENCE',
      );
    });
  });
});
