import { trace } from '@opentelemetry/api';
import { pino, stdSerializers } from 'pino';
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

/**
 * Postgres error fields that carry **row values**, stripped before an error is
 * logged.
 *
 * `redact` cannot reach these. pino serialises an `err` by copying every own
 * enumerable property, and postgres.js puts `detail`, `where` and `hint` on its
 * errors — so a constraint violation logs `Failing row contains (...)`, which is
 * the entire row. On `wash_jobs` that is the WKB-encoded location of a parked
 * car; on `washer_profiles` it is an identity-document reference; on `users` it
 * would be a phone number that `redact` protects everywhere else.
 *
 * Verified rather than assumed: a probe through the real config showed the
 * coordinates surviving redaction in full.
 *
 * Nothing diagnostic is lost. `code`, `constraint`, `table`, `column`, `schema`,
 * `message` and the stack all survive, and those name *which* invariant failed —
 * which is what anyone reading the line actually needs. The row values only ever
 * told us what the caller sent, and we are not allowed to keep that.
 */
const PG_ROW_BEARING_FIELDS = ['detail', 'where', 'hint'] as const;

export function serializeError(err: unknown): unknown {
  const serialized = stdSerializers.err(err as Error) as Record<string, unknown>;
  for (const field of PG_ROW_BEARING_FIELDS) {
    if (field in serialized) serialized[field] = '[redacted]';
  }
  return serialized;
}

export const REDACT_OPTIONS = {
  paths: [
    ...REDACT_PATHS,
    ...REDACT_PATHS.map((p) => `*.${p}`),
    ...REDACT_PATHS.map((p) => `req.headers.${p}`),
  ],
  censor: '[redacted]',
};

const options: LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: REDACT_OPTIONS,
  serializers: { err: serializeError },
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
