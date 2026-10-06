import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { reportReviewSchema, type ReviewView, reviewViewSchema } from '@parkease/contracts/driver';
import { Role } from '@parkease/contracts/enums';
import {
  ownerCreateReviewSchema,
  ownerReviewsQuerySchema,
  type OwnerSpaceReviewSummary,
  ownerSpaceReviewSummarySchema,
  respondToReviewSchema,
} from '@parkease/contracts/owner';
import { cursorPageOf } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { BookingService } from '../../domains/booking/booking.service.js';
import { CreateReviewCommand } from '../../domains/review/commands/create-review.command.js';
import { ReportReviewCommand } from '../../domains/review/commands/report-review.command.js';
import { RespondToReviewCommand } from '../../domains/review/commands/respond-to-review.command.js';
import { toReviewView } from '../../domains/review/review-view.js';
import { ReviewService } from '../../domains/review/review.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const reviewPageSchema = cursorPageOf(reviewViewSchema);

/**
 * Reviews of the owner's spaces — read, answered once, reported — and the owner's review of a
 * driver. Every read and write is scoped to spaces this owner owns; anything else is a 404,
 * never a 403 that confirms it exists (R-SEC-04).
 */
@Controller('owner/reviews')
@Roles(Role.OWNER)
export class OwnerReviewsController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly bookings: BookingService,
    private readonly create: CreateReviewCommand,
    private readonly respond: RespondToReviewCommand,
    private readonly report: ReportReviewCommand,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = ownerReviewsQuerySchema.parse(query ?? {});
    if (q.spaceId !== undefined && !(await this.bookings.ownsSpace(user.id, q.spaceId))) {
      throw new NotFoundException('Space not found.');
    }
    const page = await this.reviews.listForOwner(user.id, q);
    return parseOutgoing(
      reviewPageSchema,
      {
        items: page.items.map(toReviewView),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'owner reviews page',
    );
  }

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser): Promise<OwnerSpaceReviewSummary[]> {
    return parseOutgoing(
      z.array(ownerSpaceReviewSummarySchema),
      await this.reviews.summariesForOwner(user.id),
      'owner review summary',
    );
  }

  @Post()
  async write(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ReviewView> {
    const input = ownerCreateReviewSchema.parse(body);
    const row = await this.create.execute({
      reviewerUserId: user.id,
      reviewerRole: 'owner',
      ...input,
    });
    return parseOutgoing(reviewViewSchema, toReviewView(row), 'owner review');
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  async answer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<ReviewView> {
    const { response } = respondToReviewSchema.parse(body);
    const row = await this.respond.execute({ reviewId: id, ownerId: user.id, response });
    return parseOutgoing(reviewViewSchema, toReviewView(row), 'owner review response');
  }

  @Post(':id/report')
  async flag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ id: string; isReported: true }> {
    const input = reportReviewSchema.parse(body);
    await this.report.execute({
      reviewId: id,
      reporterUserId: user.id,
      ownerId: user.id,
      ...input,
    });
    return { id, isReported: true };
  }
}
