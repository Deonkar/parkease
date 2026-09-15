import { Module } from '@nestjs/common';

import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { PaymentService } from './payment.service.js';
import { RefundService } from './refund.service.js';

/**
 * The half of `domains/payment` that knows nothing about booking lifecycle.
 *
 * It exists to break a cycle rather than for its own sake, and the cycle is
 * real: `PaymentModule` needs `BookingService` (a capture confirms a booking),
 * and `BookingModule` needs `RefundService` (a cancellation refunds one). Those
 * two facts are both true, so one of the modules has to be smaller than the
 * domain it lives in.
 *
 * `forwardRef` would also compile. It would also leave a genuine cycle in the
 * graph, resolved at runtime by a mechanism that hides which direction the
 * dependency actually runs — and this is the part of the system where "who
 * depends on whom" needs to stay legible.
 *
 * Nothing here imports `BookingModule`, and nothing here may start to.
 */
@Module({
  imports: [LedgerModule, OutboxModule],
  providers: [PaymentService, RefundService],
  exports: [PaymentService, RefundService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PaymentCoreModule {}
