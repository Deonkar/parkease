import { Controller, Get, Query } from '@nestjs/common';
import { type QuoteResult, quoteBookingSchema } from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';

import { SpaceNotBookableError } from '../../domains/booking/errors.js';
import { assertWindowIsBookable } from '../../domains/booking/window.js';
import { PricingQuoteService } from '../../domains/pricing/quote.service.js';
import { SpaceService } from '../../domains/space/space.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * Prices a window. Reserves nothing, writes nothing.
 *
 * A GET, deliberately. Every non-GET on this API must carry an Idempotency-Key
 * (ADR-011), and the mobile client refuses to send one without it — but a quote
 * mutates nothing and there is no second execution to protect against. Making
 * it a POST would mean minting an idempotency key for a read, which teaches the
 * wrong habit about what that header is for.
 */
@Controller('driver/quotes')
@Roles(Role.DRIVER)
export class DriverQuotesController {
  constructor(
    private readonly spaces: SpaceService,
    private readonly quotes: PricingQuoteService,
  ) {}

  @Get()
  async quote(@Query() query: unknown): Promise<QuoteResult> {
    const input = quoteBookingSchema.parse(query);

    const space = await this.spaces.findBookable(input.spaceId, input.vehicleType);
    if (space === undefined) throw new SpaceNotBookableError();

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    // The same validator the real booking will face, so a window that cannot be
    // sold is refused here rather than after the driver taps to commit.
    assertWindowIsBookable(space.schedule, input.durationType, startsAt, endsAt);

    const quote = await this.quotes.forBooking({
      pricing: space.pricing,
      zoneId: space.zoneId,
      vehicleType: input.vehicleType,
      durationType: input.durationType,
      startsAt,
      endsAt,
    });

    return {
      quote: {
        basePaise: quote.basePaise,
        surgePremiumPaise: quote.surgePremiumPaise,
        gstPaise: quote.gstPaise,
        totalPaise: quote.driverTotalPaise,
        ownerEarningsPaise: quote.ownerEarningsPaise,
        surgeMultiplierBp: quote.surgeMultiplierBp,
      },
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    } as QuoteResult;
  }
}
