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
  adminPartnerDetailSchema,
  adminPartnerSchema,
  adminPartnersQuerySchema,
  partnerDecisionSchema,
  partnerKindSchema,
  partnerRejectSchema,
  type PartnerKind,
} from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import { offsetPageOf } from '@parkease/contracts/primitives';
import type { FastifyRequest } from 'fastify';

import { ReviewPartnerCommand } from '../../domains/identity/commands/review-partner.command.js';
import { PartnerQueries } from '../../domains/identity/partner.queries.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import type { AdminActor } from '../../platform/observability/audit.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';
import { CloudinaryService } from '../../platform/storage/cloudinary.service.js';

import { partnerDocumentsOf } from './views/partner-documents.view.js';

const partnersPageSchema = offsetPageOf(adminPartnerSchema);

/**
 * Valet and washer verification (task 18a). A person can be both, so every route that names one
 * names which profile it means. The detail carries the documents behind five-minute signed links:
 * they are generated per request and never stored.
 */
@Controller('admin/partners')
@Roles(Role.ADMIN)
export class AdminPartnersController {
  constructor(
    private readonly queries: PartnerQueries,
    private readonly review: ReviewPartnerCommand,
    private readonly storage: CloudinaryService,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = adminPartnersQuerySchema.parse(query ?? {});
    const { items, total } = await this.queries.list(q);
    return parseOutgoing(
      partnersPageSchema,
      { items, meta: { page: q.page, pageSize: q.pageSize, total } },
      'admin partner list',
    );
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind: unknown) {
    return this.view(id, partnerKindSchema.parse(kind));
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { kind } = partnerDecisionSchema.parse(body);
    await this.review.verify({ userId: id, kind }, actorOf(user, request));
    return this.view(id, kind);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { kind, notes } = partnerRejectSchema.parse(body);
    await this.review.reject({ userId: id, kind, notes }, actorOf(user, request));
    return this.view(id, kind);
  }

  private async view(id: string, kind: PartnerKind) {
    const found = await this.queries.detail(id, kind);
    if (found === undefined) throw new NotFoundException('Partner not found.');

    const { documentIds, ...partner } = found;
    return parseOutgoing(
      adminPartnerDetailSchema,
      {
        ...partner,
        documents: partnerDocumentsOf(this.storage, documentIds, { userId: found.userId, kind }),
      },
      'admin partner detail',
    );
  }
}

/** The IP is a property of the connection; the audit row is written three layers down. */
const actorOf = (user: AuthUser, request: FastifyRequest): AdminActor => ({
  userId: user.id,
  ipAddress: request.ip,
});
