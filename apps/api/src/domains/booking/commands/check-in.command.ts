import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CheckInMethod } from '@parkease/contracts/enums';

import { env } from '../../../platform/config/env.schema.js';
import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { CheckInTooEarlyError, InvalidBookingReferenceError } from '../errors.js';
import { BookingEvent, assertTransition } from '../lifecycle.js';
import { verifyBookingReference } from '../qr.js';

/**
 * Self check-in opens only once the booking has started and no owner scan has
 * happened for ten minutes. Most listed spaces are unattended, so demanding an
 * owner scan would strand drivers; but a driver scanning their own QR proves
 * nothing, so the fallback is delayed and recorded distinctly.
 */
export const DRIVER_FALLBACK_DELAY_MS = 10 * 60 * 1000;

export type CheckInActor = 'owner' | 'driver';

export interface CheckInInput {
  readonly bookingId: string;
  readonly actorId: string;
  readonly by: CheckInActor;
  /** Present for an owner scan; absent for the driver's time-gated fallback. */
  readonly token?: string;
}

export function assertFallbackWindowOpen(booking: { startsAt: Date }, now: Date): void {
  if (now.getTime() < booking.startsAt.getTime() + DRIVER_FALLBACK_DELAY_MS) {
    throw new CheckInTooEarlyError();
  }
}

@Injectable()
export class CheckInCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly availability: AvailabilityService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * One command, two authorisation contexts (ADR-016). The owner route and the
   * driver route differ in who is allowed to call and what they get back; the
   * transition itself is decided in exactly one place.
   */
  async execute(input: CheckInInput) {
    const now = new Date();

    if (input.by === 'owner') {
      if (input.token === undefined) throw new InvalidBookingReferenceError();
      const { bookingId } = verifyBookingReference(input.token, env.BOOKING_QR_SECRET, now);

      // The token proves the reference is ours. It does not prove which booking
      // the scanner meant, so a validly signed token for a different booking
      // must not check this one in.
      if (bookingId !== input.bookingId) throw new InvalidBookingReferenceError();
    }

    const booking =
      input.by === 'owner'
        ? await this.bookings.findOnSpaceOwnedBy(input.bookingId, input.actorId)
        : await this.bookings.findOwnedByDriver(input.bookingId, input.actorId);
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    const nextStatus = assertTransition(booking.status, BookingEvent.CHECK_IN);

    if (input.by === 'driver') assertFallbackWindowOpen(booking, now);

    const method: CheckInMethod = input.by === 'owner' ? 'owner_scan' : 'driver_fallback';

    return withTransaction(this.db, async (tx) => {
      const active = await this.bookings.markCheckedIn(tx, booking.id, nextStatus, method, now);
      await this.availability.setSlotStatus(tx, booking.id, 'active');

      await this.outbox.enqueue(
        tx,
        {
          type: 'booking.checked-in',
          payload: { bookingId: booking.id, method, driverId: booking.driverId },
        },
        // Completion is scheduled from here rather than at creation: a booking
        // nobody ever arrived for should not quietly complete itself.
        {
          type: 'booking.complete',
          availableAt: booking.endsAt,
          payload: { bookingId: booking.id },
        },
      );

      return active;
    });
  }
}
