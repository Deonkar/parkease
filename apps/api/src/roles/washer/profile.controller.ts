import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  createWasherProfileSchema,
  submitWasherDocumentsSchema,
  type WasherProfileView,
} from '@parkease/contracts/washer';

import { CarwashService } from '../../domains/carwash/carwash.service.js';
import { CreateWasherProfileCommand } from '../../domains/carwash/commands/create-washer-profile.command.js';
import { WasherProfileNotFoundError } from '../../domains/carwash/errors.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { Roles } from '../../platform/rbac/roles.decorator.js';

@Controller('washer/profile')
@Roles(Role.WASHER)
export class WasherProfileController {
  constructor(
    private readonly carwash: CarwashService,
    private readonly createProfile: CreateWasherProfileCommand,
  ) {}

  @Get()
  async profile(@CurrentUser() user: AuthUser): Promise<WasherProfileView> {
    const profile = await this.carwash.profileFor(user.id);
    // A domain code, not a bare NotFoundException: a bare one carries no `error`
    // field, so the filter answers code 'ERROR' and the app cannot tell "not
    // registered yet" (a first-run state with a next step) from a real failure.
    if (profile === null) throw new WasherProfileNotFoundError();
    return profile;
  }

  /**
   * Registering as a business or a gig partner. §13.10.
   *
   * Both types land in one row behind a `partner_type` discriminator and take
   * the same assignment path; what differs is what they must supply, which the
   * contract enforces rather than this controller.
   */
  @Post()
  async register(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<WasherProfileView> {
    const input = createWasherProfileSchema.parse(body);
    return this.createProfile.execute({ ...input, userId: user.id });
  }

  /**
   * An ID image for review, never an identity number (security.md §5.3).
   *
   * The document is an upload id: files go through `POST /uploads`, which
   * validates magic bytes rather than trusting a content type (R-VAL-01), and
   * lands in Cloudinary with private delivery. Verification is a human step, so
   * `verification_status` moves to `pending` and an admin looks (task 18).
   */
  @Post('documents')
  async submitDocuments(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<WasherProfileView> {
    const input = submitWasherDocumentsSchema.parse(body);

    return this.carwash.submitDocuments(user.id, {
      idDocumentId: input.idDocumentId,
      ...(input.businessPhotoIds === undefined ? {} : { businessPhotoIds: input.businessPhotoIds }),
    });
  }
}
