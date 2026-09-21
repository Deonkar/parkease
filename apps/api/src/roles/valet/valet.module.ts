import { Module } from '@nestjs/common';

import { ValetModule as ValetDomainModule } from '../../domains/valet/valet.module.js';
import { AuthModule } from '../../platform/auth/auth.module.js';

import { ValetAvailabilityController } from './availability.controller.js';
import { ValetEarningsController } from './earnings.controller.js';
import { ValetJobsController } from './jobs.controller.js';
import { ValetProfileController } from './profile.controller.js';
import { ValetTrackingGateway } from './tracking.gateway.js';

/**
 * The gateway owns the socket handlers and nothing else. Publishing lives in
 * `domains/valet/tracking.publisher.ts`, so the driver's controller can push a
 * status change into this namespace without importing a sibling role folder —
 * which ESLint refuses, correctly (ADR-016, R-ARCH-04).
 */
@Module({
  imports: [ValetDomainModule, AuthModule],
  controllers: [
    ValetJobsController,
    ValetAvailabilityController,
    ValetEarningsController,
    ValetProfileController,
  ],
  providers: [ValetTrackingGateway],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ValetRoleModule {}
