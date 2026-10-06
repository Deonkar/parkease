import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { moderationQueueItemSchema, removeReviewSchema } from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { cursorPageOf, paginationQuerySchema } from '@parkease/contracts/primitives';
import type { FastifyRequest } from 'fastify';

import {
  ModerateReviewCommand,
  type ModerationActor,
} from '../../domains/review/commands/moderate-review.command.js';
import type { ReviewRecord } from '../../domains/review/review.service.js';
import { ReviewService } from '../../domains/review/review.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const queuePageSchema = cursorPageOf(moderationQueueItemSchema);

interface ModerationOutcome {
  readonly id: string;
  readonly moderationStatus: string;
  readonly isReported: boolean;
}

const outcome = (review: ReviewRecord): ModerationOutcome => ({
  id: review.id,
  moderationStatus: review.moderationStatus,
  isReported: review.isReported,
});

/**
 * The reported-review queue (task 17 §17.10). Screens land in task 18. Both actions are audited
 * in the same transaction as the change; rate limits take the `ADMIN:*` budget.
 */
@Controller('admin/moderation/reviews')
@Roles(Role.ADMIN)
export class AdminModerationController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly moderate: ModerateReviewCommand,
  ) {}

  @Get()
  async queue(@Query() query: unknown) {
    const q = paginationQuerySchema.parse(query ?? {});
    const page = await this.reviews.moderationQueue(q);
    return parseOutgoing(
      queuePageSchema,
      {
        items: page.items.map(({ review, reports, impact }) => ({
          id: review.id,
          targetType: review.targetType,
          targetId: review.targetId,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt.toISOString(),
          reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
          impact,
        })),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'moderation queue',
    );
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ModerationOutcome> {
    const { reason } = removeReviewSchema.parse(body);
    return outcome(await this.moderate.remove(id, actorOf(user, request), reason));
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ModerationOutcome> {
    return outcome(await this.moderate.dismiss(id, actorOf(user, request)));
  }
}

/** The IP is a property of the connection; the audit row is written three layers down. */
const actorOf = (user: AuthUser, request: FastifyRequest): ModerationActor => ({
  userId: user.id,
  role: user.activeRole,
  ipAddress: request.ip,
});
