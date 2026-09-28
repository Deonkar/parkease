import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SpaceOccupancyQuery } from '../../src/domains/space/queries/occupancy.js';

import { type Harness, seedSpace, startHarness, stopHarness, truncateSpaces } from './harness.js';

describe('space occupancy', () => {
  let h: Harness;
  let occupancy: SpaceOccupancyQuery;

  beforeAll(async () => {
    h = await startHarness();
    occupancy = new SpaceOccupancyQuery(h.db);
  }, 300_000);

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
  });

  const from = new Date('2026-09-10T02:30:00.000Z'); // 08:00 IST
  const to = new Date('2026-09-10T10:30:00.000Z'); // 16:00 IST, an 8-hour window
  const at = (hoursFromStart: number) => new Date(from.getTime() + hoursFromStart * 3_600_000);

  /** A booking row plus its slot, in an explicit window, status and vehicle type. */
  const seed = async (
    spaceId: string,
    slotIndex: number,
    starts: Date,
    ends: Date,
    status: string,
    vehicleType: 'car' | 'two_wheeler' = 'car',
  ) => {
    const [booking] = await h.sql<{ id: string }[]>`
      INSERT INTO bookings (driver_id, space_id, vehicle_type, duration_type, starts_at, ends_at,
        status, base_paise, surge_premium_paise, parkease_fee_paise, gst_paise, total_paise,
        owner_earnings_paise)
      VALUES (${h.driverId}, ${spaceId}, ${vehicleType}, 'hourly', ${starts.toISOString()},
        ${ends.toISOString()}, ${status}, 3000, 0, 450, 0, 3000, 2550)
      RETURNING id`;
    if (booking === undefined) throw new Error('failed to seed booking');
    await h.sql`
      INSERT INTO booking_slots (booking_id, space_id, vehicle_type, slot_index, period, status)
      VALUES (${booking.id}, ${spaceId}, ${vehicleType}, ${slotIndex},
        tstzrange(${starts.toISOString()}::timestamptz, ${ends.toISOString()}::timestamptz, '[)'),
        ${status === 'completed' ? 'released' : 'confirmed'})`;
  };

  it('is 24 booked slot-hours over 6 slots × 8 hours = 5000 bp', async () => {
    const spaceId = await seedSpace(h, { lat: 12.93, lng: 77.62, carSlots: 2, twoWheelerSlots: 4 });
    await seed(spaceId, 0, at(0), at(8), 'confirmed');
    await seed(spaceId, 1, at(0), at(8), 'active');
    // Completed: its slot is `released`, and it must still count (spec §2).
    await seed(spaceId, 0, at(0), at(8), 'completed', 'two_wheeler');
    await seed(spaceId, 1, at(-4), at(0), 'completed', 'two_wheeler'); // before the window: 0

    const [row] = await occupancy.forOwner(h.ownerId, { from, to });
    expect(row?.occupancyBp).toBe(5_000);
  });

  it('clips a booking that runs past the window', async () => {
    const spaceId = await seedSpace(h, { lat: 12.93, lng: 77.62, carSlots: 1 });
    await seed(spaceId, 0, at(4), at(12), 'active'); // 4 of its 8 hours fall inside

    const [row] = await occupancy.forOwner(h.ownerId, { from, to });
    expect(row?.occupancyBp).toBe(5_000);
  });

  it('is 0 with no bookings, and ignores cancelled ones', async () => {
    const spaceId = await seedSpace(h, { lat: 12.93, lng: 77.62, carSlots: 2 });
    await seed(spaceId, 0, at(0), at(8), 'cancelled');

    const [row] = await occupancy.forOwner(h.ownerId, { from, to });
    expect(row?.occupancyBp).toBe(0);
  });
});
