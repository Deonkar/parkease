import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import { type ValetProfileView } from '@parkease/contracts/valet';
import { z } from 'zod';

import { ValetService } from '../../domains/valet/valet.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

/**
 * A licence and its expiry, submitted for review.
 *
 * The document is an upload id, never bytes: files go through `POST /uploads`,
 * which validates magic bytes rather than trusting a content type (R-VAL-01).
 * The expiry is the driver's own claim at this point — verification is a human
 * step, and `verification_status` stays `pending` until somebody looks.
 */
const submitDocumentsSchema = z.object({
  licenceDocumentId: z.string().min(1).max(255),
  licenceExpiresAt: z.string().datetime(),
  vehicleMake: z.string().min(1).max(64).optional(),
  vehicleNumber: z.string().min(1).max(32).optional(),
});

@Controller('valet/profile')
@Roles(Role.VALET)
export class ValetProfileController {
  constructor(private readonly valet: ValetService) {}

  @Get()
  async profile(@CurrentUser() user: AuthUser): Promise<ValetProfileView> {
    const profile = await this.valet.profileFor(user.id);
    if (profile === null) throw new NotFoundException();
    return profile;
  }

  @Post('documents')
  async submitDocuments(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<ValetProfileView> {
    const input = submitDocumentsSchema.parse(body);

    const profile = await this.valet.submitDocuments(user.id, {
      licenceDocumentId: input.licenceDocumentId,
      licenceExpiresAt: new Date(input.licenceExpiresAt),
      ...(input.vehicleMake === undefined ? {} : { vehicleMake: input.vehicleMake }),
      ...(input.vehicleNumber === undefined ? {} : { vehicleNumber: input.vehicleNumber }),
    });

    return profile;
  }
}
