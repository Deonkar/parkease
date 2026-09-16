import { Module } from '@nestjs/common';

import { SurgeModule } from '../../domains/surge/surge.module.js';

import { AdminSurgeController } from './surge.controller.js';

/**
 * The first `roles/admin` folder. Same shape as `roles/owner` and
 * `roles/driver`: controllers only, importing the domains they delegate to, and
 * imported by nothing (ADR-016).
 */
@Module({
  imports: [SurgeModule],
  controllers: [AdminSurgeController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
