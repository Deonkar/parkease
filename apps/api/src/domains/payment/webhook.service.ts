import { createHash } from 'node:crypto';

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  RAZORPAY_WEBHOOK_PATH,
  type RazorpayWebhookPayload,
  razorpayWebhookPayloadSchema,
} from '@parkease/contracts/public';

import { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { logger } from '../../platform/observability/logger.js';

import { ConfirmPaymentCommand } from './commands/confirm-payment.command.js';
import { FailPaymentCommand } from './commands/fail-payment.command.js';
import { ProcessRefundCommand } from './commands/process-refund.command.js';
import { VerificationService } from './verification.service.js';

export interface IncomingWebhook {
  readonly rawBody: Buffer | undefined;
  readonly signature: unknown;
  readonly eventId: unknown;
}

/** The endpoint string the idempotency table's public-scope CHECK matches on. */
const WEBHOOK_ENDPOINT = `POST ${RAZORPAY_WEBHOOK_PATH}`;

@Injectable()
export class WebhookService {
  constructor(
    private readonly verification: VerificationService,
    private readonly idempotency: IdempotencyService,
    private readonly confirmPayment: ConfirmPaymentCommand,
    private readonly failPayment: FailPaymentCommand,
    private readonly processRefund: ProcessRefundCommand,
  ) {}

  /**
   * Signature, then schema, then dedup, then dispatch — in that order, and the
   * order is the security property.
   *
   * Nothing about the body is believed before the HMAC verifies, including its
   * shape: parsing first would mean an unauthenticated caller could choose which
   * of our code paths runs before we know who they are.
   */
  async handle(input: IncomingWebhook): Promise<void> {
    this.verification.verifyWebhookSignature(input.rawBody, input.signature);

    // Safe to parse now: the bytes are provably Razorpay's. `rawBody` is defined
    // here — verification throws otherwise — but narrowing it explicitly beats
    // a non-null assertion on the one input we trust least.
    const rawBody = input.rawBody ?? Buffer.alloc(0);
    const event = razorpayWebhookPayloadSchema.parse(JSON.parse(rawBody.toString('utf8')));

    const eventId = this.dedupKey(input.eventId, event.id, rawBody);

    const claim = await this.idempotency.claim({
      key: eventId,
      // No user. Razorpay is talking to us about a payment, not a user retrying
      // their own mutation — which is why `idempotency_keys.user_id` is nullable
      // for exactly this endpoint prefix.
      userId: null,
      endpoint: WEBHOOK_ENDPOINT,
      requestHash: createHash('sha256').update(rawBody).digest('hex'),
    });

    switch (claim.outcome) {
      case 'replay':
        // Razorpay redelivers on any non-2xx and occasionally on a 2xx. A
        // redelivered payment.captured must not credit the owner twice.
        logger.info({ eventId, event: event.event }, 'webhook redelivery ignored');
        return;

      case 'in_flight':
        // Another instance has the same event open. Dropping it is correct:
        // that instance will finish, and a duplicate run is exactly what the
        // claim exists to prevent.
        logger.info({ eventId, event: event.event }, 'webhook already being handled');
        return;

      case 'conflict':
        // Same event id, different bytes. Either Razorpay reused an id or
        // someone is replaying a captured id with a forged body — and the
        // signature check means only the first is actually possible. Either way
        // we do not guess which body is the real one.
        logger.warn({ eventId, event: event.event }, 'webhook event id reused with a new body');
        throw new UnprocessableEntityException('That event id has already been used.');

      case 'proceed':
        break;
    }

    try {
      await this.dispatch(event);
      await this.idempotency.store(eventId, 200, { received: true });
    } catch (error) {
      // Release the claim so Razorpay's retry can actually re-run. Holding it
      // would leave the event permanently `in_flight` and silently drop every
      // redelivery — a capture that never confirms, with no failure anywhere
      // to show for it (R-FAIL-01).
      await this.idempotency.release(eventId);
      throw error;
    }
  }

  private async dispatch(parsed: RazorpayWebhookPayload): Promise<void> {
    switch (parsed.event) {
      case 'payment.captured': {
        const entity = parsed.payload.payment.entity;
        const result = await this.confirmPayment.execute({
          razorpayOrderId: entity.order_id,
          razorpayPaymentId: entity.id,
          method: entity.method ?? null,
        });
        logger.info({ outcome: result.outcome }, 'payment.captured handled');
        return;
      }

      case 'payment.failed': {
        const entity = parsed.payload.payment.entity;
        await this.failPayment.execute({
          razorpayOrderId: entity.order_id,
          razorpayPaymentId: entity.id,
          reason: entity.error_description ?? entity.error_code ?? null,
        });
        return;
      }

      case 'refund.processed': {
        const entity = parsed.payload.refund.entity;
        const result = await this.processRefund.execute({
          razorpayRefundId: entity.id,
          razorpayPaymentId: entity.payment_id,
          amountPaise: entity.amount,
        });

        if (!result.settled) {
          // The refund row is not written yet, so there is nothing to settle
          // against. Throwing gets a retry from Razorpay, by which time the
          // worker will have recorded the gateway's refund id.
          throw new Error(`No local refund recorded for ${entity.id} yet`);
        }
        return;
      }

      case 'unhandled':
        // 200, not a retry. Razorpay redelivers on any non-2xx, and an event we
        // were never going to handle would redeliver until it expired.
        logger.info({ event: parsed.rawEvent }, 'unhandled razorpay event');
        return;
    }
  }

  /**
   * The delivery's identity, in order of preference: Razorpay's own header, the
   * envelope's id, then a hash of the bytes.
   *
   * The fallback is what makes this safe rather than merely tidy — without it an
   * event carrying neither id would get no claim at all, and every redelivery
   * would re-run. Hashing the body means identical bytes dedupe identically,
   * which is exactly what a redelivery is.
   */
  private dedupKey(header: unknown, envelopeId: string | undefined, rawBody: Buffer): string {
    if (typeof header === 'string' && header.length > 0) return header;
    if (envelopeId !== undefined && envelopeId.length > 0) return envelopeId;
    return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
  }
}
