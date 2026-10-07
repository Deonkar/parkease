import { Module } from '@nestjs/common';

import { IdentityModule } from '../../domains/identity/identity.module.js';
import { NotificationModule } from '../../domains/notification/notification.module.js';
import { PayoutModule } from '../../domains/payout/payout.module.js';
import { StorageModule } from '../../platform/storage/storage.module.js';

import { MeController } from './me.controller.js';
import { MeNotificationsController } from './notifications.controller.js';
import { MePayoutsController } from './payouts.controller.js';
import { MeRouteOnboardingController } from './route-onboarding.controller.js';

@Module({
  imports: [IdentityModule, NotificationModule, PayoutModule, StorageModule],
  controllers: [
    MeController,
    MeNotificationsController,
    MePayoutsController,
    MeRouteOnboardingController,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SharedModule {}
