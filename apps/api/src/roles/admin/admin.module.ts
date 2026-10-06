import { Module } from '@nestjs/common';

import { BookingModule } from '../../domains/booking/booking.module.js';
import { IdentityModule } from '../../domains/identity/identity.module.js';
import { LedgerModule } from '../../domains/ledger/ledger.module.js';
import { PaymentModule } from '../../domains/payment/payment.module.js';
import { PayoutModule } from '../../domains/payout/payout.module.js';
import { ReviewModule } from '../../domains/review/review.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';
import { SurgeModule } from '../../domains/surge/surge.module.js';
import { StorageModule } from '../../platform/storage/storage.module.js';

import { AdminBookingsController } from './bookings.controller.js';
import { AdminDashboardController } from './dashboard.controller.js';
import { AdminFinanceController } from './finance.controller.js';
import { AdminModerationController } from './moderation.controller.js';
import { AdminPartnersController } from './partners.controller.js';
import { AdminSpacesController } from './spaces.controller.js';
import { AdminSurgeController } from './surge.controller.js';
import { AdminUsersController } from './users.controller.js';

/**
 * The first `roles/admin` folder. Same shape as `roles/owner` and
 * `roles/driver`: controllers only, importing the domains they delegate to, and
 * imported by nothing (ADR-016).
 */
@Module({
  imports: [
    SurgeModule,
    ReviewModule,
    SpaceModule,
    IdentityModule,
    StorageModule,
    BookingModule,
    PaymentModule,
    LedgerModule,
    PayoutModule,
  ],
  controllers: [
    AdminSurgeController,
    AdminModerationController,
    AdminSpacesController,
    AdminUsersController,
    AdminPartnersController,
    AdminBookingsController,
    AdminDashboardController,
    AdminFinanceController,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AdminModule {}
