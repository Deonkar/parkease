import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SlotUnavailableError } from '../../src/domains/booking/errors.js';
import { pgConstraintName, pgSqlState } from '../../src/platform/db/errors.js';

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

  /**
   * Ten parallel attempts against three slots: exactly three win, on three distinct indexes.
   *
   * Under the original ADR-007 this could only assert "at most three": racers all picked index 0
   * and most lost. Allocation now takes turns per space (an advisory lock in
   * `AvailabilityService.allocate`), so every caller sees the earlier winners and the count is
   * exact. A run with fewer than three winners means the lock is gone.
   */
  it('sells exactly three slots to ten racing callers, never more', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 3 });
    const window = windowFromNow(3, 2);

    const drivers = await Promise.all(Array.from({ length: 10 }, () => seedUser(h, 'driver')));

    const results = await Promise.allSettled(
      drivers.map((driverId) => book(spaceId, driverId, window)),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(3);
    expect(lost).toHaveLength(7);

    for (const rejection of lost) {
      // Name the SQLSTATE under Drizzle's "Failed query" wrapper, so a loser that is not a
      // clean 409 says what it actually was (S-105) instead of printing the SQL text.
      const reason: unknown = rejection.reason;
      expect(
        reason,
        `loser rejected with SQLSTATE ${pgSqlState(reason) ?? 'none'}, constraint ${pgConstraintName(reason) ?? 'none'}`,
      ).toBeInstanceOf(SlotUnavailableError);
    }

    // Every winner took a distinct index. The constraint is per slot-instance,
    // so two rows on index 0 would be the actual double-sell.
    const indexes = await h.sql<{ slot_index: number }[]>`
      SELECT slot_index FROM booking_slots
      WHERE space_id = ${spaceId} AND status = 'confirmed' ORDER BY slot_index
    `;
    expect(indexes.map((r) => r.slot_index)).toEqual([0, 1, 2]);
  });

  it('gives the next free index to a driver arriving after the first', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(4, 2);

    const a = await book(spaceId, h.driverId, window);
    const b = await book(spaceId, driverB, window);

    expect([a.slotIndex, b.slotIndex]).toEqual([0, 1]);
    expect(await heldSlots(spaceId)).toBe(2);
  });

  it('gives two concurrent callers both slots of a two-slot space', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(11, 2);

    const [a, b] = await Promise.all([
      book(spaceId, h.driverId, window),
      book(spaceId, driverB, window),
    ]);

    // Before the per-space lock, one of these lost with a 409 while index 1 was free.
    expect([a.slotIndex, b.slotIndex].sort()).toEqual([0, 1]);
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
      reason: 'changed my mind',
      by: { kind: 'driver', driverId: h.driverId },
    });

    const second = await book(spaceId, driverB, window);
    expect(second.slotIndex).toBe(0);
    expect(await heldSlots(spaceId)).toBe(1);
  });

  /**
   * The regression guard the task file asks for by name: the constraint, not the allocation
   * lock, is what makes a double sale impossible. A slot row written outside `allocate` (a
   * migration, a backfill, a future code path) gets no lock, so this writes one directly: refused
   * while `booking_slots_no_overlap` exists, accepted the moment it is dropped. If someone
   * "simplifies" migration 0005 away, this is the test that notices.
   */
  it('depends on booking_slots_no_overlap, and proves it', async () => {
    const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
    const driverB = await seedUser(h, 'driver');
    const window = windowFromNow(9, 2);
    const later = windowFromNow(20, 2);

    await book(spaceId, h.driverId, window);
    // A second booking, legitimately on a later window, whose slot row is then forged onto the
    // first window by hand.
    const other = await book(spaceId, driverB, later);
    const forge = () => h.sql`
      INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
      VALUES (${other.booking.id}, ${spaceId}, 'car', 0,
              tstzrange(${window.startsAt.toISOString()}::timestamptz,
                        ${window.endsAt.toISOString()}::timestamptz, '[)'),
              'confirmed')`;

    await expect(forge()).rejects.toMatchObject({ code: '23P01' });

    await h.sql`ALTER TABLE booking_slots DROP CONSTRAINT booking_slots_no_overlap`;
    try {
      // Without the constraint nothing stops it: index 0 is now sold twice for one window.
      await forge();
      expect(await heldSlots(spaceId)).toBe(3);
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
