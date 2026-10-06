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
  Req,
} from '@nestjs/common';
import {
  adminSpaceDetailSchema,
  adminSpaceQueueItemSchema,
  adminSpaceQueueQuerySchema,
  spaceDecisionNotesSchema,
} from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { offsetPageOf } from '@parkease/contracts/primitives';
import type { FastifyRequest } from 'fastify';

import { AdminSpaceQueries } from '../../domains/space/admin-space.queries.js';
import {
  ReviewSpaceCommand,
  type ReviewOutcome,
} from '../../domains/space/commands/review-space.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import type { AdminActor } from '../../platform/observability/audit.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const queuePageSchema = offsetPageOf(adminSpaceQueueItemSchema);

/**
 * The listing approval queue (task 18a). Approve takes no body; reject and request-changes owe
 * the owner an explanation. Each decision is audited and announced in the transaction that makes it.
 */
@Controller('admin/spaces')
@Roles(Role.ADMIN)
export class AdminSpacesController {
  constructor(
    private readonly queries: AdminSpaceQueries,
    private readonly review: ReviewSpaceCommand,
  ) {}

  @Get()
  async queue(@Query() query: unknown) {
    const q = adminSpaceQueueQuerySchema.parse(query ?? {});
    const { items, total } = await this.queries.queue(q);
    return parseOutgoing(
      queuePageSchema,
      { items, meta: { page: q.page, pageSize: q.pageSize, total } },
      'admin space queue',
    );
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const space = await this.queries.detail(id);
    if (space === undefined) throw new NotFoundException('Space not found.');
    return parseOutgoing(adminSpaceDetailSchema, space, 'admin space detail');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ReviewOutcome> {
    return this.review.approve(id, actorOf(user, request));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ReviewOutcome> {
    const { notes } = spaceDecisionNotesSchema.parse(body);
    return this.review.reject(id, notes, actorOf(user, request));
  }

  @Post(':id/request-changes')
  @HttpCode(HttpStatus.OK)
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ReviewOutcome> {
    const { notes } = spaceDecisionNotesSchema.parse(body);
    return this.review.requestChanges(id, notes, actorOf(user, request));
  }
}

/** The IP is a property of the connection; the audit row is written three layers down. */
const actorOf = (user: AuthUser, request: FastifyRequest): AdminActor => ({
  userId: user.id,
  ipAddress: request.ip,
});
