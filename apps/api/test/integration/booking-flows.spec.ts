import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CheckInTooEarlyError,
  ExpiredBookingReferenceError,
  ExtensionConflictError,
  InvalidBookingReferenceError,
  SpaceNotBookableError,
} from '../../src/domains/booking/errors.js';
import { IllegalBookingTransitionError } from '../../src/domains/booking/lifecycle.js';
import { QR_VALIDITY_MS, signBookingReference } from '../../src/domains/booking/qr.js';
import { env } from '../../src/platform/config/env.schema.js';

import {
  type BookingStack,
  buildBookingStack,
  markActive,
  markConfirmed,
  startedMinutesAgo,
  windowFromNow,
  zoneOf,
} from './booking-harness.js';
import {
  type Harness,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
  surgePayload,
  truncateSpaces,
} from './harness.js';

const QR_SECRET = env.BOOKING_QR_SECRET;

describe('booking flows', () => {
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
      vehicleNumber: 'KA-01-AB-1234',
    });

  const slotRow = async (bookingId: string) => {
    const rows = await h.sql<{ status: string; lower: string; upper: string }[]>`
      SELECT status, lower(period)::text AS lower, upper(period)::text AS upper
      FROM booking_slots WHERE booking_id = ${bookingId}
    `;
    return rows[0];
  };

  const bookingRow = async (bookingId: string) => {
    const rows = await h.sql<
      {
        status: string;
        total_paise: string;
        check_in_method: string | null;
        checked_in_at: string | null;
        cancellation_reason: string | null;
        surge_multiplier_bp: number;
      }[]
    >`SELECT status, total_paise, check_in_method, checked_in_at, cancellation_reason,
             surge_multiplier_bp
       FROM bookings WHERE id = ${bookingId}`;
    return rows[0];
  };

  /** Every posting in the table must balance, per txn_id. Feeds ledger-balance. */
  const unbalancedTxns = async () => {
    return h.sql<{ txn_id: string }[]>`
      SELECT txn_id
      FROM ledger_entries
      GROUP BY txn_id
      HAVING sum(CASE WHEN direction = 'debit'  THEN amount_paise ELSE 0 END)
          <> sum(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END)
    `;
  };

  describe('create', () => {
    it('writes the booking, the slot, the ledger and the outbox in one commit', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking, quote, slotIndex } = await book(spaceId, h.driverId, windowFromNow(2, 2));

      expect(booking.status).toBe('pending_payment');
      expect(slotIndex).toBe(0);

      // 2 hours at ₹30, no surge: base 6000, fee 900, GST 162, total 6162.
      expect(quote.basePaise).toBe(6000);
      expect(quote.driverTotalPaise).toBe(6162);
      expect(quote.ownerEarningsPaise).toBe(5100);

      // The slot is held at `confirmed` while the booking is `pending_payment`.
      // That is the ten-minute hold, and the reason the window cannot be sold
      // twice during checkout.
      expect((await slotRow(booking.id))?.status).toBe('confirmed');

      const ledger = await h.sql<{ n: number }[]>`
        SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries WHERE booking_id = ${booking.id}
      `;
      expect(ledger[0]?.n).toBe(1);

      const outbox = await h.sql<{ type: string; available_at: string }[]>`
        SELECT type, available_at::text FROM outbox_messages ORDER BY type
      `;
      expect(outbox.map((m) => m.type)).toEqual([
        'booking.created',
        'booking.expire-unpaid',
        'booking.remind',
      ]);
      expect(await unbalancedTxns()).toHaveLength(0);
    });

    it('applies the surge multiplier in force when the quote is issued', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.5));

      const { quote } = await book(spaceId, h.driverId, windowFromNow(2, 2));

      // The worked example from the task file, to the paise.
      expect(quote.basePaise).toBe(6000);
      expect(quote.surgePremiumPaise).toBe(3000);
      expect(quote.gstPaise).toBe(702);
      expect(quote.driverTotalPaise).toBe(9702);
      expect(quote.ownerEarningsPaise).toBe(5100);
      expect(quote.parkeaseFeePaise).toBe(3900);
      expect(5100 + 3900 + 702).toBe(9702);
    });

    it.each([
      ['inactive', { approvalStatus: 'inactive' }],
      ['pending_approval', { approvalStatus: 'pending_approval' }],
      ['rejected', { approvalStatus: 'rejected' }],
      ['soft-deleted', { deleted: true }],
    ])('refuses a new booking on a %s space', async (_label, overrides) => {
      const spaceId = await seedSpace(h, {
        lat: 12.9345,
        lng: 77.6266,
        carSlots: 1,
        ...overrides,
      });
      await expect(book(spaceId, h.driverId, windowFromNow(2, 2))).rejects.toBeInstanceOf(
        SpaceNotBookableError,
      );
    });

    it('refuses a vehicle type the space has no slots for', async () => {
      const spaceId = await seedSpace(h, {
        lat: 12.9345,
        lng: 77.6266,
        carSlots: 0,
        twoWheelerSlots: 2,
      });
      await expect(book(spaceId, h.driverId, windowFromNow(2, 2))).rejects.toBeInstanceOf(
        SpaceNotBookableError,
      );
    });
  });

  describe('cancel', () => {
    it('releases the slot and reverses the receivable to zero', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);

      await stack.cancel.execute({
        bookingId: booking.id,
        driverId: h.driverId,
        reason: 'plans changed',
      });

      expect((await bookingRow(booking.id))?.status).toBe('cancelled');
      expect((await bookingRow(booking.id))?.cancellation_reason).toBe('plans changed');
      expect((await slotRow(booking.id))?.status).toBe('released');

      // Two postings that net to nothing on every account — a reversal, never an
      // UPDATE or a DELETE (R-MONEY-07).
      const net = await h.sql<{ account: string; balance: string }[]>`
        SELECT account,
               sum(CASE WHEN direction = 'debit' THEN amount_paise ELSE -amount_paise END)::text
                 AS balance
        FROM ledger_entries WHERE booking_id = ${booking.id} GROUP BY account
      `;
      for (const row of net) expect(row.balance).toBe('0');
      expect(await unbalancedTxns()).toHaveLength(0);
    });

    it('refuses a second cancel, and writes no second reversal', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);

      await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });

      await expect(
        stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null }),
      ).rejects.toBeInstanceOf(IllegalBookingTransitionError);

      const txns = await h.sql<{ n: number }[]>`
        SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries WHERE booking_id = ${booking.id}
      `;
      expect(txns[0]?.n).toBe(2);
    });

    it('refuses to cancel an unpaid hold — the expiry job owns that', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));

      await expect(
        stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null }),
      ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    });

    it('cancels an active booking, which prd.md §8 needs for the 50% tier', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markActive(h, booking.id);

      await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });
      expect((await bookingRow(booking.id))?.status).toBe('cancelled');
      expect((await slotRow(booking.id))?.status).toBe('released');
    });

    it('is a 404 for another driver, not a 403', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);
      const stranger = await seedUser(h, 'driver');

      await expect(
        stack.cancel.execute({ bookingId: booking.id, driverId: stranger, reason: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('extend', () => {
    it('moves the slot range and charges only the delta', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const window = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, window);
      await markConfirmed(h, booking.id);

      const newEndsAt = new Date(window.endsAt.getTime() + 3_600_000);
      const { delta } = await stack.extend.execute({
        bookingId: booking.id,
        driverId: h.driverId,
        newEndsAt,
      });

      // One more hour at ₹30: base 3000, fee 450, GST 81, total 3081.
      expect(delta.basePaise).toBe(3000);
      expect(delta.driverTotalPaise).toBe(3081);

      // Compared in SQL: parsing Postgres' timestamptz text rendering in JS is
      // a second source of bugs in an assertion about the first. The lower bound
      // must not have moved — an extension stretches the end, never the start.
      const moved = await h.sql<{ upper_moved: boolean; lower_held: boolean }[]>`
        SELECT upper(period) = ${newEndsAt.toISOString()}::timestamptz    AS upper_moved,
               lower(period) = ${window.startsAt.toISOString()}::timestamptz AS lower_held
        FROM booking_slots WHERE booking_id = ${booking.id}
      `;
      expect(moved[0]).toEqual({ upper_moved: true, lower_held: true });

      // The booking's totals accumulate, so bookings_balance_check still holds.
      expect((await bookingRow(booking.id))?.total_paise).toBe('9243');
      expect(await unbalancedTxns()).toHaveLength(0);
    });

    it('is refused when the slot is booked right after, and leaves the range alone', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const first = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, first);
      await markConfirmed(h, booking.id);

      const driverB = await seedUser(h, 'driver');
      await book(spaceId, driverB, {
        startsAt: first.endsAt,
        endsAt: new Date(first.endsAt.getTime() + 7_200_000),
      });

      const before = await slotRow(booking.id);
      await expect(
        stack.extend.execute({
          bookingId: booking.id,
          driverId: h.driverId,
          newEndsAt: new Date(first.endsAt.getTime() + 3_600_000),
        }),
      ).rejects.toBeInstanceOf(ExtensionConflictError);

      expect(await slotRow(booking.id)).toEqual(before);
    });

    it('prices the extension at the multiplier frozen on the booking', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const zone = await zoneOf(h, spaceId);
      await h.redis.set(`surge:${zone}`, surgePayload(1.5));

      const window = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, window);
      await markConfirmed(h, booking.id);
      expect((await bookingRow(booking.id))?.surge_multiplier_bp).toBe(15_000);

      // Surge triples between booking and extension. The driver must not be
      // repriced mid-stay: the multiplier was frozen when the quote was issued.
      await h.redis.set(`surge:${zone}`, surgePayload(3));

      const { delta } = await stack.extend.execute({
        bookingId: booking.id,
        driverId: h.driverId,
        newEndsAt: new Date(window.endsAt.getTime() + 3_600_000),
      });

      // One hour at 1.5x: base 3000, surge premium 1500, fee 1950, GST 351.
      expect(delta.surgePremiumPaise).toBe(1500);
      expect(delta.driverTotalPaise).toBe(4851);
    });

    /**
     * The main reason anyone extends: the car is in the space right now. This
     * failed with a 400 "you cannot book a time in the past" until the window
     * validator learned that an extension's start has already legitimately
     * happened. Every other extend test here uses a `confirmed` booking with a
     * future start, which is exactly why none of them caught it.
     */
    it('extends a booking that is already under way', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markActive(h, booking.id);
      // Started 40 minutes ago and runs for another 80.
      await startedMinutesAgo(h, booking.id, 40);

      // Epoch millis out of SQL. Postgres' own timestamptz text rendering
      // carries an offset, so string-munging it back into a Date is a second
      // thing to get wrong inside a test about the first.
      const target = await h.sql<{ next_ms: string }[]>`
        SELECT (extract(epoch from ends_at + interval '1 hour') * 1000)::bigint::text AS next_ms
        FROM bookings WHERE id = ${booking.id}
      `;
      const nextMs = target[0]?.next_ms;
      if (nextMs === undefined) throw new Error('booking vanished');

      const { delta } = await stack.extend.execute({
        bookingId: booking.id,
        driverId: h.driverId,
        newEndsAt: new Date(Number(nextMs)),
      });

      expect(delta.driverTotalPaise).toBeGreaterThan(0);
      expect((await bookingRow(booking.id))?.status).toBe('active');
    });

    it('refuses to extend a cancelled booking', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const window = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, window);
      await markConfirmed(h, booking.id);
      await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });

      await expect(
        stack.extend.execute({
          bookingId: booking.id,
          driverId: h.driverId,
          newEndsAt: new Date(window.endsAt.getTime() + 3_600_000),
        }),
      ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    });

    it('is a 404 for another driver', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const window = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, window);
      await markConfirmed(h, booking.id);
      const stranger = await seedUser(h, 'driver');

      await expect(
        stack.extend.execute({
          bookingId: booking.id,
          driverId: stranger,
          newEndsAt: new Date(window.endsAt.getTime() + 3_600_000),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('check-in', () => {
    const confirmedBooking = async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);
      return { spaceId, bookingId: booking.id };
    };

    it('an owner scanning a valid QR on their own space activates the booking', async () => {
      const { bookingId } = await confirmedBooking();
      const token = signBookingReference(bookingId, QR_SECRET, new Date());

      await stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token });

      const row = await bookingRow(bookingId);
      expect(row?.status).toBe('active');
      expect(row?.check_in_method).toBe('owner_scan');
      expect(row?.checked_in_at).not.toBeNull();
      expect((await slotRow(bookingId))?.status).toBe('active');
    });

    it("is a 404 for an owner scanning a booking on someone else's space", async () => {
      const { bookingId } = await confirmedBooking();
      const otherOwner = await seedUser(h, 'owner');
      const token = signBookingReference(bookingId, QR_SECRET, new Date());

      await expect(
        stack.checkIn.execute({ bookingId, actorId: otherOwner, by: 'owner', token }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a tampered QR', async () => {
      const { bookingId } = await confirmedBooking();
      const token = signBookingReference(bookingId, QR_SECRET, new Date());
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token: tampered }),
      ).rejects.toBeInstanceOf(InvalidBookingReferenceError);
    });

    it('rejects an expired QR, distinctly from a forged one', async () => {
      const { bookingId } = await confirmedBooking();
      const stale = new Date(Date.now() - QR_VALIDITY_MS - 1000);
      const token = signBookingReference(bookingId, QR_SECRET, stale);

      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token }),
      ).rejects.toBeInstanceOf(ExpiredBookingReferenceError);
    });

    it('rejects a validly signed QR for a different booking', async () => {
      const { bookingId } = await confirmedBooking();
      const other = await confirmedBooking();
      // Signature verifies. It just is not this booking's reference, and the
      // token alone must not decide which booking gets checked in.
      const token = signBookingReference(other.bookingId, QR_SECRET, new Date());

      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token }),
      ).rejects.toBeInstanceOf(InvalidBookingReferenceError);
    });

    it('refuses an owner scan with no token at all', async () => {
      const { bookingId } = await confirmedBooking();
      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner' }),
      ).rejects.toBeInstanceOf(InvalidBookingReferenceError);
    });

    it('refuses driver self check-in before the fallback window opens', async () => {
      const { bookingId } = await confirmedBooking();
      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.driverId, by: 'driver' }),
      ).rejects.toBeInstanceOf(CheckInTooEarlyError);
    });

    it('allows driver self check-in once the window opens, recorded distinctly', async () => {
      const { bookingId } = await confirmedBooking();
      // Eleven minutes past the start: one past the ten-minute fallback delay.
      await startedMinutesAgo(h, bookingId, 11);

      await stack.checkIn.execute({ bookingId, actorId: h.driverId, by: 'driver' });

      const row = await bookingRow(bookingId);
      expect(row?.status).toBe('active');
      // The column a dispute over whether a car ever arrived is settled from.
      expect(row?.check_in_method).toBe('driver_fallback');
    });

    it('refuses check-in on a booking that was never paid for', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      const token = signBookingReference(booking.id, QR_SECRET, new Date());

      await expect(
        stack.checkIn.execute({ bookingId: booking.id, actorId: h.ownerId, by: 'owner', token }),
      ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    });

    it('refuses a second check-in on an already active booking', async () => {
      const { bookingId } = await confirmedBooking();
      const token = signBookingReference(bookingId, QR_SECRET, new Date());
      await stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token });

      await expect(
        stack.checkIn.execute({ bookingId, actorId: h.ownerId, by: 'owner', token }),
      ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    });
  });

  /**
   * prd.md §8: "existing bookings honoured". This is a test, not a hope — the
   * bookable gate is on *new* bookings only, and everything already sold has to
   * keep working after an owner switches a space off.
   */
  describe('a space deactivated after the booking was made', () => {
    const deactivate = (spaceId: string) =>
      h.sql`UPDATE spaces SET approval_status = 'inactive' WHERE id = ${spaceId}`;

    it('leaves the booking readable', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await deactivate(spaceId);

      const found = await stack.bookings.findOwnedByDriver(booking.id, h.driverId);
      expect(found?.id).toBe(booking.id);
      expect((await stack.bookings.findWithSpace(booking.id))?.space.id).toBe(spaceId);
    });

    it('leaves the booking check-in-able', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);
      await deactivate(spaceId);

      const token = signBookingReference(booking.id, QR_SECRET, new Date());
      await stack.checkIn.execute({
        bookingId: booking.id,
        actorId: h.ownerId,
        by: 'owner',
        token,
      });
      expect((await bookingRow(booking.id))?.status).toBe('active');
    });

    it('leaves the booking cancellable', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const { booking } = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, booking.id);
      await deactivate(spaceId);

      await stack.cancel.execute({ bookingId: booking.id, driverId: h.driverId, reason: null });
      expect((await bookingRow(booking.id))?.status).toBe('cancelled');
    });

    /**
     * The one honest exception, called out rather than hidden. Extending needs a
     * fresh quote, and `findBookable` is what supplies the rate card; a
     * deactivated space refuses. Stretching a booking on a space the owner has
     * switched off is closer to a new sale than to honouring an old one, so the
     * refusal is the intended behaviour and this pins it.
     */
    it('refuses to extend, because an extension is a new sale', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const window = windowFromNow(2, 2);
      const { booking } = await book(spaceId, h.driverId, window);
      await markConfirmed(h, booking.id);
      await deactivate(spaceId);

      await expect(
        stack.extend.execute({
          bookingId: booking.id,
          driverId: h.driverId,
          newEndsAt: new Date(window.endsAt.getTime() + 3_600_000),
        }),
      ).rejects.toBeInstanceOf(SpaceNotBookableError);
    });
  });

  describe('the ledger, table-wide', () => {
    it('balances after every flow this task can produce', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 2 });
      await h.redis.set(`surge:${await zoneOf(h, spaceId)}`, surgePayload(1.8));

      const created = await book(spaceId, h.driverId, windowFromNow(2, 2));
      await markConfirmed(h, created.booking.id);
      await stack.extend.execute({
        bookingId: created.booking.id,
        driverId: h.driverId,
        newEndsAt: new Date(windowFromNow(2, 2).endsAt.getTime() + 3_600_000),
      });

      const driverB = await seedUser(h, 'driver');
      const cancelled = await book(spaceId, driverB, windowFromNow(20, 3));
      await markConfirmed(h, cancelled.booking.id);
      await stack.cancel.execute({
        bookingId: cancelled.booking.id,
        driverId: driverB,
        reason: 'nope',
      });

      expect(await unbalancedTxns()).toHaveLength(0);

      // And no posting is empty or negative — the CHECK would reject either, so
      // a row here proves the composition never tried.
      const bad = await h.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ledger_entries WHERE amount_paise <= 0
      `;
      expect(bad[0]?.n).toBe(0);
    });
  });
});
