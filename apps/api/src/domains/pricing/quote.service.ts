import { Injectable } from '@nestjs/common';
import type { DurationType, VehicleType } from '@parkease/contracts/enums';
import { type Quote, quote } from '@parkease/contracts/money';
import type { SpacePricing } from '@parkease/contracts/owner';
import { toPaise, toRate } from '@parkease/contracts/primitives';

import { NO_SURGE, SurgeService } from '../surge/surge.service.js';

import { basePriceFor } from './duration.js';

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

const BASIS_POINTS = 10_000;

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
  async forBooking(input: QuoteForBookingInput): Promise<Quote> {
    const multipliers = await this.surge.multipliersFor([input.zoneId]);
    const surgeMultiplier = multipliers.get(input.zoneId) ?? NO_SURGE;

    const basePaise = basePriceFor(
      input.pricing,
      input.vehicleType,
      input.durationType,
      input.startsAt,
      input.endsAt,
    );

    return quote({ basePaise, surgeMultiplier: toRate(surgeMultiplier) });
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
    const surgeMultiplier = toRate(input.surgeMultiplierBp / BASIS_POINTS);

    const priceUpTo = (endsAt: Date): number =>
      basePriceFor(input.pricing, input.vehicleType, input.durationType, input.startsAt, endsAt);

    const deltaBasePaise = priceUpTo(input.newEndsAt) - priceUpTo(input.currentEndsAt);

    return quote({ basePaise: toPaise(Math.max(0, deltaBasePaise)), surgeMultiplier });
  }
}
