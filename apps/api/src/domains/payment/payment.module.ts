import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../platform/idempotency/idempotency.module.js';
import { OutboxModule } from '../../platform/outbox/outbox.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

import { ConfirmPaymentCommand } from './commands/confirm-payment.command.js';
import { CreateOrderCommand } from './commands/create-order.command.js';
import { FailPaymentCommand } from './commands/fail-payment.command.js';
import { ProcessRefundCommand } from './commands/process-refund.command.js';
import { OrderService } from './order.service.js';
import { PaymentCoreModule } from './payment-core.module.js';
import { RAZORPAY } from './razorpay.client.js';
import { RazorpaySdkClient } from './razorpay.sdk.js';
import { VerificationService } from './verification.service.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [PaymentCoreModule, BookingModule, LedgerModule, OutboxModule, IdempotencyModule],
  providers: [
    // Bound by token rather than by class so a test can supply a double and
    // assert the gateway was *not* called — which is how the Route constraint
    // and the onboarding refusal are tested.
    { provide: RAZORPAY, useClass: RazorpaySdkClient },
    OrderService,
    VerificationService,
    WebhookService,
    CreateOrderCommand,
    ConfirmPaymentCommand,
    FailPaymentCommand,
    ProcessRefundCommand,
  ],
  exports: [
    PaymentCoreModule,
    VerificationService,
    WebhookService,
    CreateOrderCommand,
    ConfirmPaymentCommand,
    FailPaymentCommand,
    ProcessRefundCommand,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PaymentModule {}
