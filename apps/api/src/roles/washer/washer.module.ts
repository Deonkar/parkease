import { Module } from '@nestjs/common';

import { CarwashModule } from '../../domains/carwash/carwash.module.js';
import { AuthModule } from '../../platform/auth/auth.module.js';

import { WasherAvailabilityController } from './availability.controller.js';
import { WasherEarningsController } from './earnings.controller.js';
import { WasherJobsController } from './jobs.controller.js';
import { WasherProfileController } from './profile.controller.js';
import { WasherServicesController } from './services.controller.js';

@Module({
  imports: [CarwashModule, AuthModule],
  controllers: [
    WasherJobsController,
    WasherServicesController,
    WasherAvailabilityController,
    WasherEarningsController,
    WasherProfileController,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class WasherRoleModule {}
