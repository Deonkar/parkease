import { Module } from '@nestjs/common';

import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentModule } from '../payment/payment.module.js';

import { WashAssignmentService } from './assignment.service.js';
import { CarwashService } from './carwash.service.js';
import { CatalogService } from './catalog.service.js';
import { AcceptWashCommand } from './commands/accept-wash.command.js';
import { AdvanceWashCommand } from './commands/advance-wash.command.js';
import { CancelWashCommand } from './commands/cancel-wash.command.js';
import { CreateWashOrderCommand } from './commands/create-wash-order.command.js';
import { CreateWasherProfileCommand } from './commands/create-washer-profile.command.js';
import { RequestCarwashCommand } from './commands/request-carwash.command.js';
import { SetWasherAvailabilityCommand } from './commands/set-availability.command.js';
import { UpsertWashServiceCommand } from './commands/upsert-service.command.js';
import { WasherEarningsQuery } from './queries/washer-earnings.query.js';

const PROVIDERS = [
  CarwashService,
  CatalogService,
  WashAssignmentService,
  WasherEarningsQuery,
  RequestCarwashCommand,
  AcceptWashCommand,
  AdvanceWashCommand,
  CancelWashCommand,
  CreateWashOrderCommand,
  CreateWasherProfileCommand,
  SetWasherAvailabilityCommand,
  UpsertWashServiceCommand,
];

/**
 * `PaymentModule` is imported for two things and both are the order path:
 * `PaymentService` supplies the partner's Linked Account (checked at accept,
 * re-checked at pay) and the open-order lookup, and `OrderService` mints the
 * wash's own Razorpay order.
 *
 * No cycle: nothing under `domains/payment` imports this module, and nothing
 * may start to. A wash knows about payments; payments do not know about washes.
 */
@Module({
  imports: [LedgerModule, OutboxModule, PaymentModule],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CarwashModule {}
