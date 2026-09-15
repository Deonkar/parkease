import { Module } from '@nestjs/common';

import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentCoreModule } from '../payment/payment-core.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { SpaceModule } from '../space/space.module.js';

import { AvailabilityService } from './availability.service.js';
import { BookingService } from './booking.service.js';
import { CancelBookingCommand } from './commands/cancel-booking.command.js';
import { CheckInCommand } from './commands/check-in.command.js';
import { CreateBookingCommand } from './commands/create-booking.command.js';
import { ExtendBookingCommand } from './commands/extend-booking.command.js';

@Module({
  imports: [SpaceModule, PricingModule, LedgerModule, PaymentCoreModule, OutboxModule],
  providers: [
    AvailabilityService,
    BookingService,
    CreateBookingCommand,
    CancelBookingCommand,
    ExtendBookingCommand,
    CheckInCommand,
  ],
  exports: [
    AvailabilityService,
    BookingService,
    CreateBookingCommand,
    CancelBookingCommand,
    ExtendBookingCommand,
    CheckInCommand,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BookingModule {}
