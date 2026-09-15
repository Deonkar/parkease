import { Module } from '@nestjs/common';

import { BookingModule } from '../../domains/booking/booking.module.js';
import { SpaceModule } from '../../domains/space/space.module.js';

import { OwnerBookingsController } from './bookings.controller.js';
import { OwnerSpacesController } from './spaces.controller.js';

@Module({
  imports: [SpaceModule, BookingModule],
  controllers: [OwnerSpacesController, OwnerBookingsController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OwnerModule {}
