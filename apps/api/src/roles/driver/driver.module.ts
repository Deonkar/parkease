import { Module } from '@nestjs/common';

import { BookingModule } from '../../domains/booking/booking.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';

import { DriverBookingsController } from './bookings.controller.js';
import { DriverSearchController } from './search.controller.js';

@Module({
  imports: [SpaceModule, BookingModule],
  controllers: [DriverSearchController, DriverBookingsController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DriverModule {}
