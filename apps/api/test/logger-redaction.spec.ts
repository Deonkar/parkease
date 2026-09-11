import { Writable } from 'node:stream';

import { pino } from 'pino';
import { describe, it, expect } from 'vitest';

const REDACT_PATHS = [
  'phone',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'authorization',
  'accountNumber',
  'ifscCode',
  'upiId',
  'aadhaar',
  'razorpaySignature',
  'password',
  'cookie',
];

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
