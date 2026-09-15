import { describe, expect, it } from 'vitest';

import { razorpayWebhookPayloadSchema } from '../src/public/razorpay-webhook.js';

const captured = {
  entity: 'event',
  id: 'evt_test_capture',
  contains: ['payment'],
  created_at: 1_789_000_000,
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_abc123',
        order_id: 'order_abc123',
        amount: 9702,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
      },
    },
  },
};

describe('razorpayWebhookPayloadSchema', () => {
  it('parses a payment.captured envelope', () => {
    const parsed = razorpayWebhookPayloadSchema.parse(captured);

    expect(parsed.event).toBe('payment.captured');
    if (parsed.event !== 'payment.captured') throw new Error('unreachable');
    expect(parsed.payload.payment.entity.amount).toBe(9702);
  });

  it('parses a refund.processed envelope', () => {
    const parsed = razorpayWebhookPayloadSchema.parse({
      entity: 'event',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: { id: 'rfnd_1', payment_id: 'pay_abc123', amount: 8702, status: 'processed' },
        },
      },
    });

    expect(parsed.event).toBe('refund.processed');
  });

  it('accepts an event we do not handle, so we can 200 it instead of retrying forever', () => {
    const parsed = razorpayWebhookPayloadSchema.parse({
      entity: 'event',
      event: 'settlement.processed',
      payload: { anything: true },
    });

    expect(parsed.event).toBe('unhandled');
    if (parsed.event !== 'unhandled') throw new Error('unreachable');
    expect(parsed.rawEvent).toBe('settlement.processed');
  });

  it('rejects a rupee amount rather than truncating it', () => {
    // 97.02 is the same money as 9702 paise and a hundredfold error if it is
    // ever read as paise. Parsing is where that has to stop (R-MONEY-01).
    const rupees = structuredClone(captured);
    rupees.payload.payment.entity.amount = 97.02;

    expect(() => razorpayWebhookPayloadSchema.parse(rupees)).toThrow();
  });

  it('rejects a negative amount', () => {
    const negative = structuredClone(captured);
    negative.payload.payment.entity.amount = -9702;

    expect(() => razorpayWebhookPayloadSchema.parse(negative)).toThrow();
  });

  it('rejects a payment.captured with no order to join against', () => {
    const orphan = structuredClone(captured) as Record<string, unknown> & {
      payload: { payment: { entity: Record<string, unknown> } };
    };
    delete orphan.payload.payment.entity.order_id;

    expect(() => razorpayWebhookPayloadSchema.parse(orphan)).toThrow();
  });

  it('rejects anything that is not an event envelope', () => {
    expect(() => razorpayWebhookPayloadSchema.parse({ event: 'payment.captured' })).toThrow();
    expect(() => razorpayWebhookPayloadSchema.parse({ entity: 'payment' })).toThrow();
    expect(() => razorpayWebhookPayloadSchema.parse(null)).toThrow();
    expect(() => razorpayWebhookPayloadSchema.parse('payment.captured')).toThrow();
  });

  it('does not accept a captured event whose payload is simply absent', () => {
    // The shape the old `z.record(z.unknown())` schema let through, and the
    // reason every handler field below it was an `as` in disguise.
    expect(() =>
      razorpayWebhookPayloadSchema.parse({ entity: 'event', event: 'payment.captured' }),
    ).toThrow();
  });
});
