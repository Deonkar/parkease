import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { windowFromNow } from './booking-harness.js';
import { type Harness, seedSpace, seedUser, startHarness, stopHarness } from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * Task 21 §21.4: booking creation p95 under 500ms (prd.md §12), measured as wall time on
 * `POST /driver/bookings`. It goes through HTTP rather than the command so the idempotency claim,
 * the validation pipe and the response envelope are inside the number, the way a driver feels it.
 *
 * Sequential on purpose: this is the latency budget, not a concurrency test, and
 * `booking-concurrency.spec.ts` owns the races. Ten spaces of ten slots are all booked for the
 * same window, so later requests walk past taken slot indexes before finding a free one — the
 * probe gets more expensive as the space fills, which is the case worth timing.
 */
const BOOKINGS = 100;
const WARMUP = 5;
const SPACES = 10;
const SLOTS_PER_SPACE = 10;

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe('booking creation performance', () => {
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

  it(`holds p95 under 500ms across ${String(BOOKINGS)} sequential bookings`, async () => {
    const spaceIds: string[] = [];
    for (let i = 0; i < SPACES; i += 1) {
      spaceIds.push(
        await seedSpace(h, {
          lat: 12.9345 + i * 0.001,
          lng: 77.6266,
          carSlots: SLOTS_PER_SPACE,
        }),
      );
    }
    const window = windowFromNow(3, 2);
    const drivers = await Promise.all(
      Array.from({ length: BOOKINGS + WARMUP }, () => seedUser(h, 'driver')),
    );

    const durations: number[] = [];
    for (const [i, driverId] of drivers.entries()) {
      actingAs.user = { id: driverId, roles: ['driver'], activeRole: 'driver' };
      // Warm-up requests book a later window so they do not take slots the measured ones need.
      const bookingWindow = i < WARMUP ? windowFromNow(30 + i * 3, 2) : window;

      const started = performance.now();
      const response = await http.request({
        method: 'POST',
        url: '/api/v1/driver/bookings',
        headers: { 'idempotency-key': crypto.randomUUID() },
        payload: {
          spaceId: spaceIds[i % SPACES],
          vehicleType: 'car',
          durationType: 'hourly',
          startsAt: bookingWindow.startsAt.toISOString(),
          endsAt: bookingWindow.endsAt.toISOString(),
        },
      });
      const elapsed = performance.now() - started;

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      if (i >= WARMUP) durations.push(elapsed);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    expect(sorted).toHaveLength(BOOKINGS);
    expect(percentile(sorted, 95)).toBeLessThan(500);

    // Every slot of every space is now held exactly once for the measured window.
    const [held] = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM booking_slots WHERE period && tstzrange(
        ${window.startsAt.toISOString()}::timestamptz, ${window.endsAt.toISOString()}::timestamptz, '[)')`;
    expect(held?.n).toBe(SPACES * SLOTS_PER_SPACE);
  });
});
