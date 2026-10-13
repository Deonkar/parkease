import { createHmac } from 'node:crypto';

import { uuidv7 } from '@parkease/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { windowFromNow } from './booking-harness.js';
import { type Harness, seedSpace, seedUser, startHarness, stopHarness } from './harness.js';
import { type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * Stress on the driver's money path, over HTTP (security and stress pass, task 21). The
 * command-level races are proven in `booking-concurrency.spec.ts`; this drives the whole pipeline —
 * guards, idempotency, the webhook claim — with many requests at once, and asserts what a
 * stampede must never do: oversell, double-charge, credit twice, or answer 5xx.
 */
const p95 = (ms: number[]) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95) - 1] ?? 0;

describe('the driver money path under load', () => {
  let h: Harness;
  let http: HttpApp;
  const razorpay = {
    fetchOrder: vi.fn(),
    createOrder: vi.fn(),
    createRefund: vi.fn(),
    findRefundByReference: vi.fn(),
  };

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h, razorpay);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  const asDriver = (id: string) => JSON.stringify({ id, roles: ['driver'], activeRole: 'driver' });

  const book = (
    driverId: string,
    spaceId: string,
    window: { startsAt: Date; endsAt: Date },
    key = uuidv7(),
  ) =>
    http.request({
      method: 'POST',
      url: '/api/v1/driver/bookings',
      headers: { 'idempotency-key': key, 'x-test-user': asDriver(driverId) },
      payload: {
        spaceId,
        vehicleType: 'car',
        durationType: 'hourly',
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
      },
    });

  it('100 drivers racing for 10 slots: exactly 10 bookings, the rest 409, no 5xx, p95 under 2 s', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 10 });
    const window = windowFromNow(3, 2);
    const drivers = await Promise.all(Array.from({ length: 100 }, () => seedUser(h, 'driver')));

    const timings: number[] = [];
    const responses = await Promise.all(
      drivers.map(async (driverId) => {
        const started = performance.now();
        const res = await book(driverId, spaceId, window);
        timings.push(performance.now() - started);
        return res.status;
      }),
    );

    expect(responses.filter((s) => s >= 500)).toEqual([]);
    expect(responses.filter((s) => s === 201)).toHaveLength(10);
    expect(responses.filter((s) => s === 409)).toHaveLength(90);
    const [sold] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bookings WHERE space_id = ${spaceId} AND status <> 'cancelled'`;
    expect(sold?.n).toBe(10);
    expect(p95(timings)).toBeLessThan(2_000);
  });

  it('50 retries of one booking under one key, all at once: one booking, every answer the same', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 5 });
    const window = windowFromNow(8, 2);
    const driverId = await seedUser(h, 'driver');
    const key = uuidv7();

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => book(driverId, spaceId, window, key)),
    );

    // The first answers 201; a retry that arrives while it runs is 409 REQUEST_IN_FLIGHT, and
    // one after is the stored 201 replayed. Never a second booking, never a 5xx.
    expect(responses.filter((r) => r.status >= 500)).toEqual([]);
    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const ids = new Set(
      responses
        .filter((r) => r.status === 201)
        .map((r) => (r.body as { data: { id: string } }).data.id),
    );
    expect(ids.size).toBe(1);
    const [made] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bookings WHERE driver_id = ${driverId}`;
    expect(made?.n).toBe(1);
  });

  it('40 deliveries of one capture at once confirm the booking and credit the owner once', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverId = await seedUser(h, 'driver');
    const created = await book(driverId, spaceId, windowFromNow(14, 2));
    expect(created.status).toBe(201);
    const { id } = (created.body as { data: { id: string } }).data;
    const [row] = await h.sql<{ total: number }[]>`
      SELECT total_paise::int AS total FROM bookings WHERE id = ${id}`;
    const booking = { id, totalPaise: row?.total ?? 0 };
    const orderId = `order_${booking.id.slice(-12)}`;
    await h.sql`
      INSERT INTO payments (booking_id, user_id, razorpay_order_id, expected_total_paise, status)
      VALUES (${booking.id}, ${driverId}, ${orderId}, ${booking.totalPaise}, 'created')`;
    razorpay.fetchOrder.mockResolvedValue({
      id: orderId,
      amountPaise: booking.totalPaise,
      amountPaidPaise: booking.totalPaise,
      currency: 'INR',
      status: 'paid',
    });
    const body = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${booking.id.slice(-12)}`,
            order_id: orderId,
            amount: booking.totalPaise,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
          },
        },
      },
    });
    const signature = createHmac('sha256', 'fake_webhook_secret_000').update(body).digest('hex');

    // Razorpay redelivers under one event id; a storm of them must still be one capture.
    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        http.request({
          method: 'POST',
          url: '/api/v1/webhooks/razorpay',
          rawPayload: body,
          headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_storm' },
        }),
      ),
    );

    expect(responses.filter((r) => r.status !== 200)).toEqual([]);
    const [state] = await h.sql<{ status: string; captures: number; owner_rows: number }[]>`
      SELECT b.status,
             (SELECT count(*)::int FROM payments p
               WHERE p.booking_id = b.id AND p.status = 'captured') AS captures,
             (SELECT count(*)::int FROM ledger_entries l
               WHERE l.booking_id = b.id AND l.account = 'owner_payable') AS owner_rows
      FROM bookings b WHERE b.id = ${booking.id}`;
    expect(state?.status).toBe('confirmed');
    expect(state?.captures).toBe(1);
    // The booking's own posting credits the owner once; a second capture would add no rows here
    // without Route, so the unbalanced-txn check is the stronger proof.
    expect(state?.owner_rows).toBe(1);
    const unbalanced = await h.sql`
      SELECT txn_id FROM ledger_entries GROUP BY txn_id
      HAVING sum(CASE direction WHEN 'debit' THEN amount_paise ELSE -amount_paise END) <> 0`;
    expect(unbalanced).toHaveLength(0);
  });
});
