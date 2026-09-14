import { Controller, Get, Query } from '@nestjs/common';
import { searchSpacesQuerySchema, type SpaceSearchItem } from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';

import { SearchService } from '../../domains/space/search.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

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
  constructor(private readonly search: SearchService) {}

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
}
