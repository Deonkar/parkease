import { Module } from '@nestjs/common';

import { ReviewModule } from '../../domains/review/review.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';
import { SurgeModule } from '../../domains/surge/surge.module.js';

import { AdminModerationController } from './moderation.controller.js';
import { AdminSpacesController } from './spaces.controller.js';
import { AdminSurgeController } from './surge.controller.js';

/**
 * The first `roles/admin` folder. Same shape as `roles/owner` and
 * `roles/driver`: controllers only, importing the domains they delegate to, and
 * imported by nothing (ADR-016).
 */
@Module({
  imports: [SurgeModule, ReviewModule, SpaceModule],
  controllers: [AdminSurgeController, AdminModerationController, AdminSpacesController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
