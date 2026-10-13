import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  requestUploadSignatureSchema,
  type RoleSession,
  roleSessionSchema,
  selfServeRoleSchema,
  switchActiveRoleSchema,
} from '@parkease/contracts/shared';
import type { FastifyRequest } from 'fastify';

import { SelfServeRoleCommand } from '../../domains/identity/commands/self-serve-role.command.js';
import { SwitchRoleCommand } from '../../domains/identity/commands/switch-role.command.js';
import { UserRepository } from '../../domains/identity/repositories/user.repository.js';
import { CurrentUser, type AuthUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';
import { CloudinaryService } from '../../platform/storage/cloudinary.service.js';
import { UploadRegistry } from '../../platform/storage/upload-registry.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly switchRole: SwitchRoleCommand,
    private readonly selfServeRole: SelfServeRoleCommand,
    private readonly cloudinary: CloudinaryService,
    private readonly userRepo: UserRepository,
    private readonly uploads: UploadRegistry,
  ) {}

  @Get()
  async getProfile(@CurrentUser() user: AuthUser) {
    const profile = await this.userRepo.getProfile(user.id);
    if (!profile) return null;
    return { ...profile, activeRole: user.activeRole };
  }

  @Post('roles/active')
  @HttpCode(HttpStatus.OK)
  async switchActiveRole(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleSession> {
    const parsed = switchActiveRoleSchema.parse(body);
    return parseOutgoing(
      roleSessionSchema,
      await this.switchRole.execute({ userId: user.id, role: parsed.role }),
      'role session',
    );
  }

  /** Take on a role yourself, and switch into it (S-149). */
  @Post('roles')
  @HttpCode(HttpStatus.OK)
  async addRole(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<RoleSession> {
    const { role } = selfServeRoleSchema.parse(body);
    return parseOutgoing(
      roleSessionSchema,
      await this.selfServeRole.execute({
        userId: user.id,
        role,
        actingAs: user.activeRole,
        ipAddress: request.ip,
      }),
      'role session',
    );
  }

  @Post('upload-signature')
  @HttpCode(HttpStatus.OK)
  async uploadSignature(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = requestUploadSignatureSchema.parse(body);
    const signed = this.cloudinary.createSignedUpload(parsed.folder, parsed.contentType);
    // Recorded before the signature leaves: an id this caller can attach later is one we issued
    // to them (S-50).
    await this.uploads.record(user.id, parsed.folder, signed.uploadId);
    return signed;
  }
}
