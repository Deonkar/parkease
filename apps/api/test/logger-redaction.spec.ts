import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, it, expect } from 'vitest';

import { REDACT_OPTIONS, serializeError } from '../src/platform/observability/logger.js';

function createTestLogger(): { logger: pino.Logger; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  /**
   * Built from the *real* config objects, not a copy of them. The duplicate
   * this file used to keep meant the test passed whatever the real list said —
   * the same shape of defect as a security control that is defined, tested and
   * never wired up.
   */
  const log = pino(
    {
      level: 'info',
      redact: REDACT_OPTIONS,
      serializers: { err: serializeError },
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

/**
 * `redact` cannot reach inside a serialised error.
 *
 * pino copies every own enumerable property off an `err`, and postgres.js puts
 * `detail` on its errors — which for a constraint violation is the whole
 * failing row. On `wash_jobs` that row carries `space_location`: the coordinates
 * of somebody's parked car (security.md §5.3). A probe through the real config
 * confirmed it survived redaction in full before `serializeError` existed.
 */
describe('postgres error details', () => {
  const pgCheckViolation = () =>
    Object.assign(new Error('new row for relation "wash_jobs" violates check constraint'), {
      severity: 'ERROR',
      code: '23514',
      table: 'wash_jobs',
      constraint: 'wash_jobs_photo_gate_check',
      detail:
        'Failing row contains (0192f3a1, washing, 0101000020E6100000C1CAA145B65F53400E4C1B2B8FD82940, 39900).',
      where: 'PL/pgSQL function inline_code_block line 3',
      hint: 'some hint',
    });

  it('keeps the failing row out of the log', () => {
    const { logger, output } = createTestLogger();
    logger.error({ err: pgCheckViolation() }, 'request failed');

    expect(output()).not.toContain('Failing row contains');
    expect(output()).not.toContain('0101000020E6100000');
  });

  it('redacts where and hint too, which also quote row values', () => {
    const { logger, output } = createTestLogger();
    logger.error({ err: pgCheckViolation() }, 'request failed');

    expect(output()).not.toContain('inline_code_block');
    expect(output()).not.toContain('some hint');
  });

  /**
   * The point is to lose the row values and keep everything that says *which*
   * invariant failed — otherwise this trades a privacy leak for an outage
   * nobody can diagnose.
   */
  it('keeps the fields that name the failure', () => {
    const { logger, output } = createTestLogger();
    logger.error({ err: pgCheckViolation() }, 'request failed');

    expect(output()).toContain('23514');
    expect(output()).toContain('wash_jobs_photo_gate_check');
    expect(output()).toContain('wash_jobs');
  });

  it('leaves an ordinary error alone', () => {
    const { logger, output } = createTestLogger();
    logger.error({ err: new Error('something broke') }, 'request failed');

    expect(output()).toContain('something broke');
  });
});
