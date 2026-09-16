import { Injectable } from '@nestjs/common';
import { NO_SURGE_SNAPSHOT } from '@parkease/contracts/admin';
import type { DurationType, SurgeBadge, VehicleType } from '@parkease/contracts/enums';
import { type Quote, quote } from '@parkease/contracts/money';
import type { SpacePricing } from '@parkease/contracts/owner';
import { toPaise } from '@parkease/contracts/primitives';

import { SurgeService } from '../surge/surge.service.js';

import { basePriceFor } from './duration.js';
import { surgeRateOf } from './surge-rate.js';

export interface QuoteForBookingInput {
  readonly pricing: SpacePricing;
  readonly zoneId: string;
  readonly vehicleType: VehicleType;
  readonly durationType: DurationType;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface QuoteForExtensionInput {
  readonly pricing: SpacePricing;
  readonly vehicleType: VehicleType;
  readonly durationType: DurationType;
  readonly startsAt: Date;
  readonly currentEndsAt: Date;
  readonly newEndsAt: Date;
  /** The multiplier frozen onto the original booking, in basis points. */
  readonly surgeMultiplierBp: number;
}

/**
 * A quote plus the name of the tier its multiplier came from.
 *
 * The badge is not derivable from `surgeMultiplierBp` without re-implementing
 * the ladder, and a ladder re-implemented in a second place is how the chip and
 * the price come to disagree. It rides along with the number it belongs to.
 */
export interface BookingQuote extends Quote {
  readonly surgeBadge: SurgeBadge | null;
}

@Injectable()
export class PricingQuoteService {
  constructor(private readonly surge: SurgeService) {}

  /**
   * Reads the surge multiplier once and freezes it into the quote. A
   * recalculation five minutes into checkout cannot change the price the driver
   * agreed to (task 10).
   *
   * This call reaches Redis, so it must happen *before* the transaction opens.
   * Holding a Postgres transaction across a Redis round trip is how connection
   * pools die (R-BE-04).
   */
  async forBooking(input: QuoteForBookingInput): Promise<BookingQuote> {
    const snapshots = await this.surge.multipliersFor([input.zoneId]);
    const snapshot = snapshots.get(input.zoneId) ?? NO_SURGE_SNAPSHOT;

    const basePaise = basePriceFor(
      input.pricing,
      input.vehicleType,
      input.durationType,
      input.startsAt,
      input.endsAt,
    );

    return {
      ...quote({ basePaise, surgeMultiplier: surgeRateOf(snapshot.multiplierBp) }),
      surgeBadge: snapshot.badge,
    };
  }

  /**
   * The delta only, priced at the multiplier locked on the original booking so a
   * driver is not repriced mid-stay.
   *
   * The delta is the difference between the whole new window and the whole old
   * one, not the price of the added minutes in isolation. That is what makes
   * part-unit rounding come out right: extending a 2-hour booking by 30 minutes
   * costs one more hour, because the third hour was already going to be billed
   * whole.
   *
   * No Redis read here, which is why it is synchronous — there is no current
   * multiplier to consult, by design.
   */
  forExtension(input: QuoteForExtensionInput): Quote {
    const surgeMultiplier = surgeRateOf(input.surgeMultiplierBp);

    const priceUpTo = (endsAt: Date): number =>
      basePriceFor(input.pricing, input.vehicleType, input.durationType, input.startsAt, endsAt);

    const deltaBasePaise = priceUpTo(input.newEndsAt) - priceUpTo(input.currentEndsAt);

    return quote({ basePaise: toPaise(Math.max(0, deltaBasePaise)), surgeMultiplier });
  }
}
