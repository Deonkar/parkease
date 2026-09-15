import { Module } from '@nestjs/common';

import { IdentityModule } from '../../domains/identity/identity.module.js';
import { PaymentModule } from '../../domains/payment/payment.module.js';

import { AuthController } from './auth.controller.js';
import { HealthController } from './health.controller.js';
import { RazorpayWebhookController } from './webhooks/razorpay.controller.js';

@Module({
  imports: [IdentityModule, PaymentModule],
  controllers: [HealthController, AuthController, RazorpayWebhookController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class PublicModule {}
