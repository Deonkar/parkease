import { Module } from '@nestjs/common';

import { BookingModule } from '../../domains/booking/booking.module.js';
import { LedgerModule } from '../../domains/ledger/ledger.module.js';
import { PricingModule } from '../../domains/pricing/pricing.module.js';
import { ReviewModule } from '../../domains/review/review.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';

import { OwnerBookingsController } from './bookings.controller.js';
import { OwnerDashboardController } from './dashboard.controller.js';
import { OwnerEarningsController } from './earnings.controller.js';
import { OwnerReviewsController } from './reviews.controller.js';
import { OwnerSpacesController } from './spaces.controller.js';

@Module({
  imports: [SpaceModule, BookingModule, LedgerModule, PricingModule, ReviewModule],
  controllers: [
    OwnerSpacesController,
    OwnerBookingsController,
    OwnerDashboardController,
    OwnerEarningsController,
    OwnerReviewsController,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OwnerModule {}
