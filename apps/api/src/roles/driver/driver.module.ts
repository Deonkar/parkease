import { Module } from '@nestjs/common';

import { BookingModule } from '../../domains/booking/booking.module.js';
import { PaymentModule } from '../../domains/payment/payment.module.js';
import { PricingModule } from '../../domains/pricing/pricing.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';
import { SurgeModule } from '../../domains/surge/surge.module.js';

import { DriverBookingsController } from './bookings.controller.js';
import { DriverPaymentsController } from './payments.controller.js';
import { DriverQuotesController } from './quotes.controller.js';
import { DriverSearchController } from './search.controller.js';

@Module({
  imports: [SpaceModule, SurgeModule, PricingModule, BookingModule, PaymentModule],
  controllers: [
    DriverSearchController,
    DriverBookingsController,
    DriverQuotesController,
    DriverPaymentsController,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DriverModule {}
