import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { requestUploadSignatureSchema, switchActiveRoleSchema } from '@parkease/contracts/shared';

import { SwitchRoleCommand } from '../../domains/identity/commands/switch-role.command.js';
import { UserRepository } from '../../domains/identity/repositories/user.repository.js';
import { CurrentUser, type AuthUser } from '../../platform/auth/current-user.decorator.js';
import type { SessionTokens } from '../../platform/auth/token.service.js';
import { CloudinaryService } from '../../platform/storage/cloudinary.service.js';
import { UploadRegistry } from '../../platform/storage/upload-registry.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly switchRole: SwitchRoleCommand,
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
  ): Promise<SessionTokens> {
    const parsed = switchActiveRoleSchema.parse(body);
    return this.switchRole.execute({ userId: user.id, role: parsed.role });
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
