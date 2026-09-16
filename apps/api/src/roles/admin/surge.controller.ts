import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  surgeConfigSchema,
  surgeZoneOverrideInputSchema,
  surgeZoneOverridePatchSchema,
  zoneIdSchema,
} from '@parkease/contracts/admin';
import { Role } from '@parkease/contracts/enums';
import type { FastifyRequest } from 'fastify';

import {
  SurgeAdminService,
  type SurgeAdminActor,
  type SurgeConfigRecord,
  type ZoneOverrideRecord,
  type ZoneOverrideWithLive,
} from '../../domains/surge/surge-admin.service.js';
import { CurrentUser, type AuthUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * Surge configuration, for operators. The screens that drive it land in task 18.
 *
 * Two independent checks stand in front of every handler, because a role is not
 * an authorisation on its own (R-SEC-*): `RolesGuard` requires the admin role,
 * and `ActiveRoleGuard` requires the caller to be *in* their admin profile —
 * staff browsing as a driver cannot reprice a city from a stale tab. There is no
 * third, ownership check to do here: nobody owns a price ladder, which is
 * exactly why every one of these five endpoints is audited instead.
 *
 * Rate limits come from `platform/ratelimit/policies.ts`, tighter on the writes
 * than the generic `ADMIN:*` budget. The `Idempotency-Key` header on the three
 * mutations is enforced globally by `IdempotencyInterceptor` (R-API-06).
 */
@Controller('admin/surge')
@Roles(Role.ADMIN)
export class AdminSurgeController {
  constructor(private readonly surgeAdmin: SurgeAdminService) {}

  @Get('config')
  async readConfig(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<SurgeConfigRecord> {
    return this.surgeAdmin.readConfig(actorOf(user, request));
  }

  @Put('config')
  async replaceConfig(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<SurgeConfigRecord> {
    // The schema is the one the worker reads the stored row back through, so a
    // config that would not parse on the way out cannot be saved on the way in.
    const next = surgeConfigSchema.parse(body);
    return this.surgeAdmin.replaceConfig(actorOf(user, request), next);
  }

  @Get('zones')
  async listZones(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ZoneOverrideWithLive[]> {
    return this.surgeAdmin.listZones(actorOf(user, request));
  }

  @Post('zones')
  @HttpCode(HttpStatus.CREATED)
  async createZone(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ZoneOverrideRecord> {
    const input = surgeZoneOverrideInputSchema.parse(body);
    return this.surgeAdmin.createZone(actorOf(user, request), input);
  }

  @Patch('zones/:zoneId')
  async updateZone(
    @Param('zoneId') zoneId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<ZoneOverrideRecord> {
    // A path segment is caller-supplied data like any other. An id that is not
    // a geohash-6 cell can match no row and no key, so it is a 400 here rather
    // than a 404 that reads like the override was deleted.
    const zone = zoneIdSchema.parse(zoneId);
    const patch = surgeZoneOverridePatchSchema.parse(body);
    return this.surgeAdmin.updateZone(actorOf(user, request), zone, patch);
  }
}

/**
 * The actor, assembled where the request still exists. The IP is a property of
 * the connection and the audit row is written three layers down, so it has to
 * be carried rather than looked up (R-SEC-10).
 */
const actorOf = (user: AuthUser, request: FastifyRequest): SurgeAdminActor => ({
  userId: user.id,
  role: user.activeRole,
  ipAddress: request.ip,
});
