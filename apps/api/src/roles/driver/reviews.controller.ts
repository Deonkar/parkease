import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createReviewSchema,
  type PendingReview,
  pendingReviewSchema,
  reportReviewSchema,
  type ReviewView,
  reviewViewSchema,
} from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';
import { cursorPageOf, paginationQuerySchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { CreateReviewCommand } from '../../domains/review/commands/create-review.command.js';
import { ReportReviewCommand } from '../../domains/review/commands/report-review.command.js';
import { toReviewView } from '../../domains/review/review-view.js';
import { ReviewService } from '../../domains/review/review.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

import { toPendingReviewView } from './views/review.view.js';

const reviewPageSchema = cursorPageOf(reviewViewSchema);

/**
 * A driver reviews the space, valet and washers on a completed booking, and reports reviews they
 * read on a space. Eligibility, ownership and the read model are `domains/review`'s (ADR-016).
 * Rate limits: `platform/ratelimit/policies.ts`; `Idempotency-Key` on every POST is global.
 */
@Controller('driver/reviews')
@Roles(Role.DRIVER)
export class DriverReviewsController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly create: CreateReviewCommand,
    private readonly report: ReportReviewCommand,
  ) {}

  @Post()
  async write(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ReviewView> {
    const input = createReviewSchema.parse(body);
    const row = await this.create.execute({
      reviewerUserId: user.id,
      reviewerRole: 'driver',
      ...input,
    });
    return parseOutgoing(reviewViewSchema, toReviewView(row), 'driver review');
  }

  @Get()
  async mine(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = paginationQuerySchema.parse(query ?? {});
    const page = await this.reviews.listByReviewer(user.id, q);
    return parseOutgoing(
      reviewPageSchema,
      {
        items: page.items.map(toReviewView),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'driver reviews page',
    );
  }

  @Get('pending')
  async pending(@CurrentUser() user: AuthUser): Promise<PendingReview[]> {
    const pending = await this.reviews.pendingFor(user.id, new Date());
    return parseOutgoing(
      z.array(pendingReviewSchema),
      pending.map(toPendingReviewView),
      'pending reviews',
    );
  }

  @Post(':id/report')
  async flag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; isReported: true }> {
    const input = reportReviewSchema.parse(body);
    await this.report.execute({ reviewId: id, reporterUserId: user.id, ...input });
    return { id, isReported: true };
  }
}
