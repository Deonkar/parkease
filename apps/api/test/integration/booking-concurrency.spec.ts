import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SlotUnavailableError } from '../../src/domains/booking/errors.js';

import {
  type BookingStack,
  buildBookingStack,
  markConfirmed,
  windowFromNow,
} from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  truncateSpaces,
} from './harness.js';

/**
 * R-TEST-03, and the test v1 listed as required while shipping code that could
 * not pass it. v1 checked availability with `SELECT COUNT(*)` against a
 * `total_slots` column: under READ COMMITTED two transactions both read "1 of 2
 * taken", both passed, and both inserted. Nothing in that write path could make
 * the second one fail.
 *
 * The fix was never a better check. It is `booking_slots_no_overlap`, a GiST
 * exclusion constraint, which is why these assertions run against real
 * PostgreSQL 18 + PostGIS on real concurrent connections (R-TEST-02) and cannot
 * be satisfied by a mock.
 */
describe('booking concurrency', () => {
  let h: Harness;
  let stack: BookingStack;

  beforeAll(async () => {
    h = await startHarness();
    stack = buildBookingStack(h);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
  });

  const book = (spaceId: string, driverId: string, window: { startsAt: Date; endsAt: Date }) =>
    stack.create.execute({
      driverId,
      spaceId,
      vehicleType: 'car',
      durationType: 'hourly',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      vehicleNumber: null,
    });

  const heldSlots = async (spaceId: string): Promise<number> => {
    const rows = await h.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM booking_slots
      WHERE space_id = ${spaceId} AND status IN ('confirmed', 'active')
    `;
    return rows[0]?.n ?? 0;
  };

  it('sells the last slot exactly once under concurrency', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(2, 2);

    const results = await Promise.allSettled([
      book(spaceId, h.driverId, window),
      book(spaceId, driverB, window),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(SlotUnavailableError);
    expect((rejected[0]?.reason as SlotUnavailableError).getStatus()).toBe(409);

    expect(await heldSlots(spaceId)).toBe(1);
  });

  it('sells exactly three of ten parallel attempts against three slots', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 3 });
    const window = windowFromNow(3, 2);

    const drivers = await Promise.all(Array.from({ length: 10 }, () => seedUser(h, 'driver')));

    const results = await Promise.allSettled(
      drivers.map((driverId) => book(spaceId, driverId, window)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(7);
    for (const rejection of results.filter((r) => r.status === 'rejected')) {
      expect(rejection.reason).toBeInstanceOf(SlotUnavailableError);
    }

    expect(await heldSlots(spaceId)).toBe(3);

    // Every winner took a distinct index. The constraint is per slot-instance,
    // so two rows on index 0 would be the actual double-sell.
    const indexes = await h.sql<{ slot_index: number }[]>`
      SELECT slot_index FROM booking_slots
      WHERE space_id = ${spaceId} AND status = 'confirmed' ORDER BY slot_index
    `;
    expect(indexes.map((r) => r.slot_index)).toEqual([0, 1, 2]);
  });

  /**
   * Sequential, deliberately, and the reason is ADR-007's accepted cost rather
   * than a weaker test. The SELECT picks the lowest free index but takes no lock,
   * so two *concurrent* callers against a two-slot space can both pick index 0
   * and one loses — a 409 even though index 1 was free. There is no retry loop by
   * decision. Run back to back, the second caller sees the first row committed
   * and moves to index 1, which is the property worth asserting: the constraint
   * is per slot-instance, not per space.
   */
  it('gives the next free index to a driver arriving after the first', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(4, 2);

    const a = await book(spaceId, h.driverId, window);
    const b = await book(spaceId, driverB, window);

    expect([a.slotIndex, b.slotIndex]).toEqual([0, 1]);
    expect(await heldSlots(spaceId)).toBe(2);
  });

  it('fails one of two concurrent callers even when another index was free', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(11, 2);

    const results = await Promise.allSettled([
      book(spaceId, h.driverId, window),
      book(spaceId, driverB, window),
    ]);

    // This is ADR-007 written as an assertion, not a defect. Both callers can
    // pick index 0 before either commits; the loser gets an instant, clearly
    // worded 409 and "try again" is a fresh intent with a new Idempotency-Key.
    // If this ever starts passing with two 201s, someone added a retry loop or a
    // lock to the hottest write path in the system, and that is a decision to
    // make deliberately rather than discover here.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const rejection of results.filter((r) => r.status === 'rejected')) {
      expect(rejection.reason).toBeInstanceOf(SlotUnavailableError);
    }
  });

  it('lets two drivers take the same slot for non-overlapping windows', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const first = windowFromNow(5, 2);
    const second = { startsAt: first.endsAt, endsAt: new Date(first.endsAt.getTime() + 7_200_000) };

    // [10:00, 12:00) and [12:00, 14:00) do not overlap under && with '[)' bounds.
    // An inclusive upper bound would make these collide, which is why the range
    // is built half-open in one place and never by hand.
    const [a, b] = await Promise.all([
      book(spaceId, h.driverId, first),
      book(spaceId, driverB, second),
    ]);

    expect(a.slotIndex).toBe(0);
    expect(b.slotIndex).toBe(0);
    expect(await heldSlots(spaceId)).toBe(2);
  });

  it('rejects a window that overlaps by a single minute', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const first = windowFromNow(6, 2);

    await book(spaceId, h.driverId, first);

    const overlapping = {
      startsAt: new Date(first.endsAt.getTime() - 60_000),
      endsAt: new Date(first.endsAt.getTime() + 3_600_000),
    };
    await expect(book(spaceId, driverB, overlapping)).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(await heldSlots(spaceId)).toBe(1);
  });

  it('rolls the whole transaction back when the constraint fires', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(7, 2);

    await book(spaceId, h.driverId, window);

    const before = await counts(h, spaceId);
    await expect(book(spaceId, driverB, window)).rejects.toBeInstanceOf(SlotUnavailableError);
    const after = await counts(h, spaceId);

    // The loser's booking row, ledger entries and outbox messages must all have
    // vanished with the rollback. A booking without a slot, or a ledger entry
    // for a booking that does not exist, is the failure this asserts against.
    expect(after).toEqual(before);
  });

  it('frees the slot for the identical window the moment it is released', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(8, 2);

    const first = await book(spaceId, h.driverId, window);
    await expect(book(spaceId, driverB, window)).rejects.toBeInstanceOf(SlotUnavailableError);

    // Cancel is legal from confirmed, never from pending_payment — an unpaid
    // hold is released by the expiry job, not by the driver.
    await markConfirmed(h, first.booking.id);
    await stack.cancel.execute({
      bookingId: first.booking.id,
      driverId: h.driverId,
      reason: 'changed my mind',
    });

    const second = await book(spaceId, driverB, window);
    expect(second.slotIndex).toBe(0);
    expect(await heldSlots(spaceId)).toBe(1);
  });

  /**
   * The regression guard the task file asks for by name: drop the constraint and
   * the double-sell becomes possible again. If someone "simplifies" migration
   * 0005 away, this is the test that notices — every other assertion here would
   * still pass by luck on an unloaded machine.
   */
  it('depends on booking_slots_no_overlap, and proves it', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(9, 2);

    await h.sql`ALTER TABLE booking_slots DROP CONSTRAINT booking_slots_no_overlap`;
    try {
      const results = await Promise.allSettled([
        book(spaceId, h.driverId, window),
        book(spaceId, driverB, window),
      ]);
      // Without the constraint, nothing in the write path can stop the second
      // insert: both SELECTs see index 0 free and both INSERTs succeed.
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(1);
      expect(await heldSlots(spaceId)).toBeGreaterThan(1);
    } finally {
      await h.sql`TRUNCATE booking_slots, bookings CASCADE`;
      await h.sql`
        ALTER TABLE booking_slots
          ADD CONSTRAINT booking_slots_no_overlap
          EXCLUDE USING gist (
            space_id WITH =, vehicle_type WITH =, slot_index WITH =, period WITH &&
          ) WHERE (status IN ('confirmed', 'active'))
      `;
    }
  });
});

async function counts(h: Harness, spaceId: string) {
  const rows = await h.sql<{ bookings: number; ledger: number; outbox: number }[]>`
    SELECT
      (SELECT count(*)::int FROM bookings WHERE space_id = ${spaceId}) AS bookings,
      (SELECT count(*)::int FROM ledger_entries le
         JOIN bookings b ON b.id = le.booking_id WHERE b.space_id = ${spaceId}) AS ledger,
      (SELECT count(*)::int FROM outbox_messages) AS outbox
  `;
  return rows[0];
}
