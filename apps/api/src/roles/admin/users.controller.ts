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
  adminUserSchema,
  adminUsersQuerySchema,
  grantRoleSchema,
  reasonSchema,
} from '@parkease/contracts/admin';
import { Role, roleSchema } from '@parkease/contracts/enums';
import { offsetPageOf } from '@parkease/contracts/primitives';
import type { FastifyRequest } from 'fastify';

import { AdminUserQueries } from '../../domains/identity/admin-user.queries.js';
import { GrantRoleCommand } from '../../domains/identity/commands/grant-role.command.js';
import { RevokeRoleCommand } from '../../domains/identity/commands/revoke-role.command.js';
import { SetUserStatusCommand } from '../../domains/identity/commands/set-user-status.command.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import type { AdminActor } from '../../platform/observability/audit.service.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

const usersPageSchema = offsetPageOf(adminUserSchema);

/**
 * People and what they may do (task 18a). Every mutation takes a reason, is audited with it, and
 * answers with the user as they now stand, so the screen redraws from the response.
 */
@Controller('admin/users')
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(
    private readonly queries: AdminUserQueries,
    private readonly grantRole: GrantRoleCommand,
    private readonly revokeRole: RevokeRoleCommand,
    private readonly setStatus: SetUserStatusCommand,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const q = adminUsersQuerySchema.parse(query ?? {});
    const { items, total } = await this.queries.list(q);
    return parseOutgoing(
      usersPageSchema,
      { items, meta: { page: q.page, pageSize: q.pageSize, total } },
      'admin user list',
    );
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.view(id);
  }

  @Post(':id/roles')
  async grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { role, reason } = grantRoleSchema.parse(body);
    await this.grantRole.execute({ userId: id, role, reason }, actorOf(user, request));
    return this.view(id);
  }

  @Post(':id/roles/:role/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role') roleParam: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const role = roleSchema.parse(roleParam);
    const { reason } = reasonSchema.parse(body);
    await this.revokeRole.execute({ userId: id, role, reason }, actorOf(user, request));
    return this.view(id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  async block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { reason } = reasonSchema.parse(body);
    await this.setStatus.block({ userId: id, reason }, actorOf(user, request));
    return this.view(id);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  async unblock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ) {
    const { reason } = reasonSchema.parse(body);
    await this.setStatus.unblock({ userId: id, reason }, actorOf(user, request));
    return this.view(id);
  }

  private async view(id: string) {
    const found = await this.queries.detail(id);
    if (found === undefined) throw new NotFoundException('User not found.');
    return parseOutgoing(adminUserSchema, found, 'admin user detail');
  }
}

/** The IP is a property of the connection; the audit row is written three layers down. */
const actorOf = (user: AuthUser, request: FastifyRequest): AdminActor => ({
  userId: user.id,
  ipAddress: request.ip,
});
