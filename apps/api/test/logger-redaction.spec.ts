import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, it, expect } from 'vitest';

import { REDACT_PATHS } from '../src/platform/observability/logger.js';

function createTestLogger(): { logger: pino.Logger; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const log = pino(
    {
      level: 'info',
      redact: {
        paths: [
          ...REDACT_PATHS,
          ...REDACT_PATHS.map((p) => `*.${p}`),
          ...REDACT_PATHS.map((p) => `req.headers.${p}`),
        ],
        censor: '[redacted]',
      },
    },
    stream,
  );

  return { logger: log, output: () => chunks.join('') };
}

describe('logger redaction', () => {
  it('redacts phone numbers', () => {
    const { logger, output } = createTestLogger();
    logger.info({ phone: '+919876543210' }, 'test');
    expect(output()).toContain('[redacted]');
    expect(output()).not.toContain('+919876543210');
  });

  it('redacts idToken', () => {
    const { logger, output } = createTestLogger();
    logger.info({ idToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...' }, 'test');
    expect(output()).toContain('[redacted]');
    expect(output()).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts refreshToken', () => {
    const { logger, output } = createTestLogger();
    logger.info({ refreshToken: 'secret-refresh-value' }, 'test');
    expect(output()).toContain('[redacted]');
    expect(output()).not.toContain('secret-refresh-value');
  });

  it('redacts accountNumber', () => {
    const { logger, output } = createTestLogger();
    logger.info({ accountNumber: '1234567890' }, 'test');
    expect(output()).toContain('[redacted]');
    expect(output()).not.toContain('1234567890');
  });

  it('redacts razorpaySignature', () => {
    const { logger, output } = createTestLogger();
    logger.info({ razorpaySignature: 'sig_abc123' }, 'test');
    expect(output()).toContain('[redacted]');
    expect(output()).not.toContain('sig_abc123');
  });

  it('redacts nested PII fields', () => {
    const { logger, output } = createTestLogger();
    logger.info({ user: { phone: '+91123', accessToken: 'tok' } }, 'test');
    const out = output();
    expect(out).not.toContain('+91123');
    expect(out).not.toContain('"accessToken":"tok"');
  });
});

describe('the redact list covers the payment identifiers', () => {
  it('redacts the Razorpay ids, not just the signature', () => {
    // A comment in confirm-payment.command.ts claimed these were already
    // redacted. A security pass found they were not. The claim is now true, and
    // this is what keeps it true.
    const { logger, output } = createTestLogger();

    logger.info(
      {
        razorpayPaymentId: 'pay_QK7xVv9pLm2Zab',
        razorpayOrderId: 'order_QK7xVv9pLm2Zab',
        razorpayRefundId: 'rfnd_QK7xVv9pLm2Zab',
        bookingId: '0192f1c0-0000-7000-8000-000000000001',
      },
      'payment event',
    );

    const line = output();
    expect(line).not.toContain('pay_QK7xVv9pLm2Zab');
    expect(line).not.toContain('order_QK7xVv9pLm2Zab');
    expect(line).not.toContain('rfnd_QK7xVv9pLm2Zab');
    // The booking id is how an on-call engineer finds the booking, and it names
    // no money movement. It stays.
    expect(line).toContain('0192f1c0-0000-7000-8000-000000000001');
  });

  it('redacts them nested one level down, where a payload usually sits', () => {
    const { logger, output } = createTestLogger();
    logger.info({ payment: { razorpayPaymentId: 'pay_nested_secret' } }, 'nested');

    expect(output()).not.toContain('pay_nested_secret');
  });
});
