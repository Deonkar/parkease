import { trace } from '@opentelemetry/api';
import { pino } from 'pino';
import type { LoggerOptions } from 'pino';

/**
 * Exported so `logger-redaction.spec.ts` asserts against *this* list rather than
 * a copy of it. The test used to keep its own duplicate, which meant it passed
 * whatever the real list said — the same shape of defect as a security control
 * that is defined, tested and never wired up.
 */
export const REDACT_PATHS = [
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
  // Not secrets on their own, but they identify a specific movement of money and
  // are the join key between our records and Razorpay's. A comment in
  // `confirm-payment.command.ts` used to claim these were already redacted; a
  // security pass found they were not, which is the worse failure of the two —
  // a claimed control nobody re-checks (R-SEC-03).
  'razorpayPaymentId',
  'razorpayOrderId',
  'razorpayRefundId',
  'password',
  'cookie',
];

const options: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      ...REDACT_PATHS,
      ...REDACT_PATHS.map((p) => `*.${p}`),
      ...REDACT_PATHS.map((p) => `req.headers.${p}`),
    ],
    censor: '[redacted]',
  },
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
  },
  formatters: { level: (label) => ({ level: label }) },
};

if (process.env['NODE_ENV'] !== 'production') {
  options.transport = { target: 'pino-pretty', options: { colorize: true } };
}

export const logger = pino(options);
