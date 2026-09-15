import { AvailabilityService } from '../../src/domains/booking/availability.service.js';
import { BookingService } from '../../src/domains/booking/booking.service.js';
import { CancelBookingCommand } from '../../src/domains/booking/commands/cancel-booking.command.js';
import { CheckInCommand } from '../../src/domains/booking/commands/check-in.command.js';
import { CreateBookingCommand } from '../../src/domains/booking/commands/create-booking.command.js';
import { ExtendBookingCommand } from '../../src/domains/booking/commands/extend-booking.command.js';
import { LedgerService } from '../../src/domains/ledger/ledger.service.js';
import { PaymentService } from '../../src/domains/payment/payment.service.js';
import { RefundService } from '../../src/domains/payment/refund.service.js';
import { PricingQuoteService } from '../../src/domains/pricing/quote.service.js';
import { SpaceService } from '../../src/domains/space/space.service.js';
import { SurgeService } from '../../src/domains/surge/surge.service.js';
import { OutboxService } from '../../src/platform/outbox/outbox.service.js';

import type { Harness } from './harness.js';

export interface BookingStack {
  readonly spaces: SpaceService;
  readonly bookings: BookingService;
  readonly availability: AvailabilityService;
  readonly ledger: LedgerService;
  readonly outbox: OutboxService;
  readonly quotes: PricingQuoteService;
  readonly payments: PaymentService;
  readonly refunds: RefundService;
  readonly create: CreateBookingCommand;
  readonly cancel: CancelBookingCommand;
  readonly extend: ExtendBookingCommand;
  readonly checkIn: CheckInCommand;
}

/**
 * The real command stack, wired by hand against the container's database.
 *
 * Not `Test.createTestingModule(AppModule)`: bootstrapping the whole container
 * constructs FirebaseVerifierService, which calls `initializeApp` with fake
 * credentials and takes DI resolution down with it (see learnings.md). Nothing
 * these tests assert lives in the DI graph — the exclusion constraint, the
 * transaction boundary and the lifecycle guard are all reachable from the
 * commands themselves.
 */
export function buildBookingStack(h: Harness): BookingStack {
  const spaces = new SpaceService(h.db);
  const bookings = new BookingService(h.db);
  const availability = new AvailabilityService();
  const ledger = new LedgerService();
  const outbox = new OutboxService();
  const quotes = new PricingQuoteService(new SurgeService(h.redis.asClient()));
  const payments = new PaymentService(h.db);
  const refunds = new RefundService(ledger, payments, outbox);

  return {
    spaces,
    bookings,
    availability,
    ledger,
    outbox,
    quotes,
    create: new CreateBookingCommand(h.db, spaces, quotes, availability, bookings, ledger, outbox),
    payments,
    refunds,
    cancel: new CancelBookingCommand(h.db, bookings, availability, payments, refunds, outbox),
    extend: new ExtendBookingCommand(h.db, bookings, spaces, quotes, availability, ledger, outbox),
    checkIn: new CheckInCommand(h.db, bookings, availability, outbox),
  };
}

/** An hour-aligned window `hoursFromNow` ahead, for predictable pricing. */
export function windowFromNow(hoursFromNow: number, durationHours: number) {
  const startsAt = new Date(Date.now() + hoursFromNow * 3_600_000);
  startsAt.setUTCMinutes(0, 0, 0);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationHours * 3_600_000) };
}

/**
 * Moves a booking to `confirmed`, the way `PayBookingCommand` will in task 9.
 *
 * Until payment capture exists, `pending_payment` is the only status the API can
 * produce, which makes cancel, extend and check-in unreachable end to end — all
 * three are legal only from `confirmed` or `active`. Driving the column directly
 * is the honest stand-in: the transition itself is proven exhaustively over all
 * 35 (status, event) pairs in booking-lifecycle.spec.ts, so what is left to test
 * here is the database behaviour on either side of it.
 */
export async function markConfirmed(h: Harness, bookingId: string): Promise<void> {
  await h.sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`;
}

/** Puts a confirmed booking into `active`, as an owner scan would. */
export async function markActive(h: Harness, bookingId: string): Promise<void> {
  await h.sql`
    UPDATE bookings
    SET status = 'active', checked_in_at = now(), check_in_method = 'owner_scan'
    WHERE id = ${bookingId}
  `;
  await h.sql`UPDATE booking_slots SET status = 'active' WHERE booking_id = ${bookingId}`;
}

/**
 * Moves a booking so it started `minutesAgo` minutes ago, keeping its duration.
 *
 * `assertWindowIsBookable` rejects a start in the past, so a booking that needs
 * to have already begun cannot be created that way — it has to be created
 * legally and then moved. Absolute rather than relative on purpose: shifting by
 * a fixed amount depends on how far ahead the fixture happened to start, which
 * is exactly the sort of arithmetic that makes a time-gated test flaky.
 *
 * The slot's range moves with it, or the exclusion constraint would be guarding
 * a window the booking no longer occupies.
 */
export async function startedMinutesAgo(
  h: Harness,
  bookingId: string,
  minutesAgo: number,
): Promise<void> {
  await h.sql`
    UPDATE bookings
    SET ends_at   = now() - make_interval(mins => ${minutesAgo}) + (ends_at - starts_at),
        starts_at = now() - make_interval(mins => ${minutesAgo})
    WHERE id = ${bookingId}
  `;
  await h.sql`
    UPDATE booking_slots bs
    SET period = tstzrange(b.starts_at, b.ends_at, '[)')
    FROM bookings b
    WHERE b.id = bs.booking_id AND bs.booking_id = ${bookingId}
  `;
}

/** The space's geohash zone, for writing a `surge:{zone}` key by hand. */
export async function zoneOf(h: Harness, spaceId: string): Promise<string> {
  const rows = await h.sql<{ zone_id: string }[]>`
    SELECT zone_id FROM spaces WHERE id = ${spaceId}
  `;
  const zone = rows[0];
  if (zone === undefined) throw new Error('space not found');
  return zone.zone_id;
}
