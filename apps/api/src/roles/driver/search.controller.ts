import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { NO_SURGE_SNAPSHOT } from '@parkease/contracts/admin';
import {
  type DefaultBooking,
  publicReviewViewSchema,
  searchSpacesQuerySchema,
  type SpaceDetail,
  type SpaceSearchItem,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';
import type { SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';
import { cursorPageOf, paginationQuerySchema } from '@parkease/contracts/primitives';

import { defaultWindowFor } from '../../domains/booking/defaults.js';
import { PricingQuoteService } from '../../domains/pricing/quote.service.js';
import { toPublicReviewView } from '../../domains/review/review-view.js';
import { ReviewService } from '../../domains/review/review.service.js';
import { isOpenAt } from '../../domains/space/schedule.js';
import { SearchService } from '../../domains/space/search.service.js';
import { countSlots } from '../../domains/space/slots.js';
import { SpaceService } from '../../domains/space/space.service.js';
import { SurgeService } from '../../domains/surge/surge.service.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
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

const publicReviewPageSchema = cursorPageOf(publicReviewViewSchema);

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
    private readonly reviews: ReviewService,
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
    const [related, availableNow, snapshots, reviewSummary, recent] = await Promise.all([
      this.spaces.loadRelated(id),
      this.spaces.availabilityAt(id, now),
      this.surge.multipliersFor([row.space.zoneId]),
      this.reviews.summaryForSpace(id),
      this.reviews.listForTarget('space', id, { limit: 3 }),
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
      reviewSummary,
      recentReviews: recent.items,
      defaultBooking:
        row.space.approvalStatus === 'active'
          ? await this.priceDefault(row.space, availableNow, now)
          : null,
    });
  }

  /**
   * Every visible review of a live space, newest first (task 17b, closes S-127). The public view:
   * no report flag. A space the driver cannot open is a 404 here too.
   */
  @Get(':id/reviews')
  async listReviews(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const q = paginationQuerySchema.parse(query ?? {});
    if ((await this.spaces.findForDriver(id)) === undefined) {
      throw new NotFoundException('That space is no longer listed.');
    }
    const page = await this.reviews.listForTarget('space', id, q);
    return parseOutgoing(
      publicReviewPageSchema,
      {
        items: page.items.map(toPublicReviewView),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'space reviews page',
    );
  }

  /**
   * Prices the "book now" default through the same QuoteService a real booking
   * uses, so the number on the button and the number on Review & Pay are
   * produced by one code path and cannot drift.
   *
   * Reserves nothing. The slot is only held once the driver actually commits.
   */
  private async priceDefault(
    space: { ownerId: string; pricing: SpacePricing; schedule: SpaceSchedule; zoneId: string },
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
      ownerId: space.ownerId,
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
        surgeMultiplierBp: quote.surgeMultiplierBp,
      },
    } as DefaultBooking;
  }
}
