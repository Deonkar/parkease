import { Controller, HttpCode, Post, Req } from '@nestjs/common';

import { WebhookService } from '../../../domains/payment/webhook.service.js';
import { Public } from '../../../platform/auth/public.decorator.js';
import type { RawBodyRequest } from '../../../platform/http/raw-body.js';

/**
 * One of the few `@Public()` endpoints in the application, and the only one that
 * moves money.
 *
 * It is unauthenticated because Razorpay cannot hold a ParkEase token; what
 * stands in for authentication is the HMAC over the raw bytes, verified before
 * anything about the body is believed. Rate limiting falls to the `WEBHOOK:*`
 * policy — 300/min per IP (`security.md` §4.3).
 *
 * The route is exempt from the global `IdempotencyInterceptor`, which requires a
 * client-minted UUID `Idempotency-Key` on every other non-GET request. Razorpay
 * sends no such header; it carries its own delivery id, and `WebhookService`
 * claims that instead (ADR-011).
 */
@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  /**
   * 200 once the event is verified and accepted. A throw becomes a non-2xx and
   * Razorpay retries, which is the behaviour we want for a handler that failed
   * — the claim is released first, so the retry actually re-runs.
   */
  @Post()
  @Public()
  @HttpCode(200)
  async handle(@Req() request: RawBodyRequest): Promise<{ readonly received: true }> {
    await this.webhooks.handle({
      rawBody: request.rawBody,
      signature: request.headers['x-razorpay-signature'],
      eventId: request.headers['x-razorpay-event-id'],
    });

    return { received: true };
  }
}
