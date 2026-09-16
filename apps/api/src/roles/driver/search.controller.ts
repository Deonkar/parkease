import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { NO_SURGE_SNAPSHOT } from '@parkease/contracts/admin';
import {
  type DefaultBooking,
  searchSpacesQuerySchema,
  type SpaceDetail,
  type SpaceSearchItem,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';
import type { SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';

import { defaultWindowFor } from '../../domains/booking/defaults.js';
import { PricingQuoteService } from '../../domains/pricing/quote.service.js';
import { isOpenAt } from '../../domains/space/schedule.js';
import { SearchService } from '../../domains/space/search.service.js';
import { countSlots } from '../../domains/space/slots.js';
import { SpaceService } from '../../domains/space/space.service.js';
import { SurgeService } from '../../domains/surge/surge.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toSpaceDetailView } from './views/space-detail.view.js';
import { toSpaceResultView } from './views/space-result.view.js';

interface SearchSpacesResponse {
  readonly items: SpaceSearchItem[];
  readonly meta: {
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

/**
 * Rate limiting comes from the `GET /api/v1/driver/spaces` policy in
 * platform/ratelimit/policies.ts — 60/min per user.
 */
@Controller('driver/spaces')
@Roles(Role.DRIVER)
export class DriverSearchController {
  constructor(
    private readonly search: SearchService,
    private readonly spaces: SpaceService,
    private readonly surge: SurgeService,
    private readonly quotes: PricingQuoteService,
  ) {}

  /**
   * Validates at the boundary, calls one domain method, maps through a view.
   * No business logic lives here (ADR-016).
   */
  @Get()
  async find(@Query() query: unknown): Promise<SearchSpacesResponse> {
    const parsed = searchSpacesQuerySchema.parse(query);
    const page = await this.search.findNearby(parsed);

    return {
      items: page.items.map(toSpaceResultView),
      meta: { limit: parsed.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
    };
  }

  /**
   * The decision screen. One space, everything the driver needs to commit.
   *
   * Availability is counted live rather than read from the search cache: the
   * list can be a minute stale and still be useful, but this is the screen the
   * driver books from, and "don't cache availability" exists for exactly this
   * moment (ADR-010).
   */
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<SpaceDetail> {
    const row = await this.spaces.findForDriver(id);
    if (row === undefined) throw new NotFoundException('That space is no longer listed.');

    const now = new Date();
    const [related, availableNow, snapshots] = await Promise.all([
      this.spaces.loadRelated(id),
      this.spaces.availabilityAt(id, now),
      this.surge.multipliersFor([row.space.zoneId]),
    ]);

    return toSpaceDetailView({
      space: row.space,
      ownerName: row.ownerName,
      ownerSince: row.ownerSince,
      isOpenNow: isOpenAt(row.space.schedule, now),
      availableNow,
      totalSlots: countSlots(related.slots),
      surge: snapshots.get(row.space.zoneId) ?? NO_SURGE_SNAPSHOT,
      photos: related.photos,
      defaultBooking:
        row.space.approvalStatus === 'active'
          ? await this.priceDefault(row.space, availableNow, now)
          : null,
    });
  }

  /**
   * Prices the "book now" default through the same QuoteService a real booking
   * uses, so the number on the button and the number on Review & Pay are
   * produced by one code path and cannot drift.
   *
   * Reserves nothing. The slot is only held once the driver actually commits.
   */
  private async priceDefault(
    space: { pricing: SpacePricing; schedule: SpaceSchedule; zoneId: string },
    availableNow: { car: number; twoWheeler: number },
    now: Date,
  ): Promise<DefaultBooking | null> {
    const window = defaultWindowFor({
      pricing: space.pricing,
      schedule: space.schedule,
      availableNow,
      now,
    });
    if (window === undefined) return null;

    const quote = await this.quotes.forBooking({
      pricing: space.pricing,
      zoneId: space.zoneId,
      vehicleType: window.vehicleType,
      durationType: window.durationType,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });

    return {
      vehicleType: window.vehicleType,
      durationType: window.durationType,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      hours: window.hours,
      quote: {
        basePaise: quote.basePaise,
        surgePremiumPaise: quote.surgePremiumPaise,
        gstPaise: quote.gstPaise,
        totalPaise: quote.driverTotalPaise,
        ownerEarningsPaise: quote.ownerEarningsPaise,
        surgeMultiplierBp: quote.surgeMultiplierBp,
      },
    } as DefaultBooking;
  }
}
