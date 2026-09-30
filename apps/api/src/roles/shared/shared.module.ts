import { Module } from '@nestjs/common';

import { IdentityModule } from '../../domains/identity/identity.module.js';
import { PayoutModule } from '../../domains/payout/payout.module.js';
import { StorageModule } from '../../platform/storage/storage.module.js';

import { MeController } from './me.controller.js';
import { MePayoutsController } from './payouts.controller.js';
import { MeRouteOnboardingController } from './route-onboarding.controller.js';

@Module({
  imports: [IdentityModule, PayoutModule, StorageModule],
  controllers: [MeController, MePayoutsController, MeRouteOnboardingController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SharedModule {}
