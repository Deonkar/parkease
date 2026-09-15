import { Inject, Injectable } from '@nestjs/common';
import type { DurationType, VehicleType } from '@parkease/contracts/enums';
import { bookingReceivableEntries } from '@parkease/contracts/money';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { LedgerService } from '../../ledger/ledger.service.js';
import { PricingQuoteService } from '../../pricing/quote.service.js';
import { SpaceService } from '../../space/space.service.js';
import { AvailabilityService } from '../availability.service.js';
import { BookingService } from '../booking.service.js';
import { SpaceNotBookableError } from '../errors.js';
import { assertWindowIsBookable } from '../window.js';

/** The hold the slot is kept under while the driver pays. */
export const PAYMENT_WINDOW_MS = 10 * 60 * 1000;
/** How far ahead of `starts_at` the reminder fires. */
export const REMINDER_LEAD_MS = 30 * 60 * 1000;

export interface CreateBookingInput {
  readonly driverId: string;
  readonly spaceId: string;
  readonly vehicleType: VehicleType;
  readonly durationType: DurationType;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly vehicleNumber: string | null;
}

@Injectable()
export class CreateBookingCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly spaces: SpaceService,
    private readonly quotes: PricingQuoteService,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: CreateBookingInput) {
    // Everything that touches the network happens before the transaction opens:
    // the space read, and the surge lookup inside the quote (R-BE-04).
    const space = await this.spaces.findBookable(input.spaceId, input.vehicleType);
    if (space === undefined) throw new SpaceNotBookableError();

    assertWindowIsBookable(space.schedule, input.durationType, input.startsAt, input.endsAt);

    const quote = await this.quotes.forBooking({
      pricing: space.pricing,
      zoneId: space.zoneId,
      vehicleType: input.vehicleType,
      durationType: input.durationType,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });

    /**
     * Read top to bottom, every rule in rules.md §7 is visible here: the business
     * row, the occupancy row, the balanced ledger entries and the outbox messages
     * share one COMMIT. If the exclusion constraint fires on the second step, the
     * ledger entries and the outbox messages never existed. There is no window in
     * which a booking exists without its slot, or a slot without its ledger
     * entry, or a booking with no expiry job scheduled.
     */
    return withTransaction(this.db, async (tx) => {
      const booking = await this.bookings.insert(tx, {
        driverId: input.driverId,
        spaceId: space.id,
        vehicleType: input.vehicleType,
        durationType: input.durationType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        vehicleNumber: input.vehicleNumber,
        status: 'pending_payment',
        quote,
      });

      const slotIndex = await this.availability.allocate(tx, {
        bookingId: booking.id,
        spaceId: space.id,
        vehicleType: input.vehicleType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });

      const txnId = await this.ledger.post(tx, {
        bookingId: booking.id,
        counterpartyUserId: input.driverId,
        entries: bookingReceivableEntries(quote),
      });

      const reminderAt = new Date(input.startsAt.getTime() - REMINDER_LEAD_MS);

      await this.outbox.enqueue(
        tx,
        {
          type: 'booking.expire-unpaid',
          availableAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
          payload: { bookingId: booking.id },
        },
        {
          type: 'booking.created',
          payload: { bookingId: booking.id, driverId: input.driverId, ownerId: space.ownerId },
        },
        // A booking made inside the reminder lead is already imminent; sending a
        // "parking in 30 min" push for it would be both late and wrong.
        ...(reminderAt.getTime() > Date.now()
          ? [
              {
                type: 'booking.remind' as const,
                availableAt: reminderAt,
                payload: { bookingId: booking.id },
              },
            ]
          : []),
      );

      return { booking, space, slotIndex, quote, txnId };
    });
  }
}
