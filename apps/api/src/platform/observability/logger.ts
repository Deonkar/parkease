import { trace } from '@opentelemetry/api';
import { pino } from 'pino';
import type { LoggerOptions } from 'pino';

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
