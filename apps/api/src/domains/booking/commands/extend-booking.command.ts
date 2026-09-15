import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { bookingReceivableEntries } from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { PricingQuoteService } from '../../pricing/quote.service.js';
import { SpaceService } from '../../space/space.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { InvalidBookingWindowError, SpaceNotBookableError } from '../errors.js';
import { IllegalBookingTransitionError } from '../lifecycle.js';
import { assertWindowIsBookable } from '../window.js';

export interface ExtendBookingInput {
  readonly bookingId: string;
  readonly driverId: string;
  readonly newEndsAt: Date;
}

@Injectable()
export class ExtendBookingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bookings: BookingService,
    private readonly spaces: SpaceService,
    private readonly quotes: PricingQuoteService,
    private readonly availability: AvailabilityService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: ExtendBookingInput) {
    const booking = await this.bookings.findOwnedByDriver(input.bookingId, input.driverId);
    if (booking === undefined) throw new NotFoundException('That booking does not exist.');

    // Extension is not one of the five lifecycle events — the status does not
    // change — so the guard is explicit rather than a call to assertTransition.
    if (booking.status !== 'confirmed' && booking.status !== 'active') {
      throw new IllegalBookingTransitionError(booking.status, 'extend');
    }

    if (input.newEndsAt.getTime() <= booking.endsAt.getTime()) {
      throw new InvalidBookingWindowError('An extension has to end later than the booking does.');
    }

    const space = await this.spaces.findBookable(booking.spaceId, booking.vehicleType);
    if (space === undefined) throw new SpaceNotBookableError();

    // The whole extended window is re-validated, not just the added tail: a
    // space closes at a time, and the extension is what pushes past it.
    assertWindowIsBookable(space.schedule, booking.durationType, booking.startsAt, input.newEndsAt);

    const delta = this.quotes.forExtension({
      pricing: space.pricing,
      vehicleType: booking.vehicleType,
      durationType: booking.durationType,
      startsAt: booking.startsAt,
      currentEndsAt: booking.endsAt,
      newEndsAt: input.newEndsAt,
      surgeMultiplierBp: booking.surgeMultiplierBp,
    });

    return withTransaction(this.db, async (tx) => {
      // May throw ExtensionConflictError: the slot is booked right after this
      // driver, and the exclusion constraint is what notices.
      await this.availability.extend(tx, booking.id, input.newEndsAt);

      const updated = await this.bookings.applyExtension(tx, booking.id, input.newEndsAt, delta);

      // An extension inside the current billing unit is free: 10:00–12:30
      // stretched to 12:45 is still three hourly units. There is nothing to
      // charge, and posting an empty transaction would fail the balance
      // assertion rather than recording a zero.
      if (delta.driverTotalPaise > 0) {
        // A separate txn_id: the extension is its own posting, so the original
        // booking's receivable stays reversible on its own terms.
        await this.ledger.post(tx, {
          bookingId: booking.id,
          counterpartyUserId: booking.driverId,
          entries: bookingReceivableEntries(delta, 'booking extended'),
        });
      }

      await this.outbox.enqueue(tx, {
        type: 'booking.extended',
        payload: {
          bookingId: booking.id,
          newEndsAt: input.newEndsAt.toISOString(),
          chargedPaise: delta.driverTotalPaise,
        },
      });

      return { booking: updated, space, delta };
    });
  }
}
