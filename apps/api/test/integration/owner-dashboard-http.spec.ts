import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type BookingStack, buildBookingStack, windowFromNow, zoneOf } from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
  truncateSpaces,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

describe('owner dashboard HTTP', () => {
  let h: Harness;
  let http: HttpApp;
  let stack: BookingStack;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
    stack = buildBookingStack(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
    actingAs.user = { id: h.ownerId, roles: ['owner'], activeRole: 'owner' };
  });

  const get = (url: string) => http.request({ method: 'GET', url: `/api/v1${url}` });

  const bookConfirmed = async (spaceId: string, hoursAhead: number, surge?: number) => {
    if (surge !== undefined) {
      await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(surge));
    }
    const window = windowFromNow(hoursAhead, 2);
    const { booking } = await stack.create.execute({
      driverId: await seedUser(h, 'driver'),
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: null,
    });
    h.redis.clear();
    await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${booking.id}`;
    return booking;
  };

  it('dashboard and earnings agree on owner earnings', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    await bookConfirmed(spaceId, 2);
    await bookConfirmed(spaceId, 6);

    const dashboard = (await get('/owner/dashboard')).body as {
      data: { month: { netPaise: number }; owedPaise: number; statement: unknown[] };
    };
    const earnings = (await get('/owner/earnings?period=month')).body as {
      data: { netPaise: number; bookings: number };
    };

    expect(dashboard.data.month.netPaise).toBe(earnings.data.netPaise);
    expect(dashboard.data.owedPaise).toBe(earnings.data.netPaise);
    expect(earnings.data.bookings).toBe(2);
    expect(dashboard.data.statement).toHaveLength(2);
  });

  it('shows a surged booking as base, fee and net — no surge, GST or total', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await bookConfirmed(spaceId, 2, 1.5);

    const response = await get('/owner/earnings/transactions?limit=1');
    expect(response.status).toBe(200);
    const body = response.body as { data: Record<string, unknown>[]; meta: { hasMore: boolean } };
    expect(body.data[0]).toMatchObject({ basePaise: 6000, feePaise: 900, netPaise: 5100 });
    for (const field of ['surgePaise', 'surgePremiumPaise', 'totalPaise', 'gstPaise']) {
      expect(body.data[0]).not.toHaveProperty(field);
    }
    expect(body.meta.hasMore).toBe(false);
  });

  it('shows a no-surge booking with the same shape', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await bookConfirmed(spaceId, 2);

    const body = (await get('/owner/earnings/transactions')).body as {
      data: Record<string, unknown>[];
    };
    expect(body.data[0]).toMatchObject({ basePaise: 6000, feePaise: 900, netPaise: 5100 });
  });

  it('lists bookings on one space, and 404s another owner’s space', async () => {
    const mine = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    await bookConfirmed(mine, 2);
    const otherOwner = await seedUser(h, 'owner');
    const theirs = await seedSpace(h, { lat: 12.95, lng: 77.64, carSlots: 1 });
    await h.sql`UPDATE spaces SET owner_id = ${otherOwner} WHERE id = ${theirs}`;

    const own = await get(`/owner/spaces/${mine}/bookings?group=upcoming`);
    expect(own.status).toBe(200);
    expect((own.body as { data: unknown[] }).data).toHaveLength(1);

    expect((await get(`/owner/spaces/${theirs}/bookings`)).status).toBe(404);
    expect((await get('/owner/bookings?group=upcoming')).status).toBe(200);
  });

  it('has no domain-partitioned bookings route (v1 duplicate)', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    expect((await get(`/bookings/space/${spaceId}`)).status).toBe(404);
  });

  it('refuses a driver-only token on every owner route', async () => {
    actingAs.user = { id: h.driverId, roles: ['driver'], activeRole: 'driver' };
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    for (const url of [
      '/owner/dashboard',
      '/owner/earnings',
      '/owner/earnings/transactions',
      '/owner/bookings',
      `/owner/spaces/${spaceId}/bookings`,
    ]) {
      expect((await get(url)).status, url).toBe(403);
    }
  });

  it('answers an unknown period with 400', async () => {
    expect((await get('/owner/earnings?period=all')).status).toBe(400);
  });

  it('shows occupancy and live status per space on the dashboard', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const body = (await get('/owner/dashboard')).body as {
      data: { spaces: { id: string; approvalStatus: string; occupancyBp: number }[] };
    };
    expect(body.data.spaces).toEqual([
      expect.objectContaining({ id: spaceId, approvalStatus: 'active', occupancyBp: 0 }),
    ]);
  });
});
