import { InternalServerErrorException } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { z } from 'zod';

import { logger } from '../observability/logger.js';

/**
 * Parses a value the SERVER built against the contract it is about to send.
 *
 * The global filter maps every `ZodError` to `400 VALIDATION_FAILED`, which is
 * right for a request body and wrong here: a row that fails its own response
 * contract is our bug, and a 400 blames the caller's phone while no 5xx alert
 * ever fires (silent failure M9, S-33). So a failure here is rethrown as a 500
 * that carries the `ZodError` as its cause, logged at error with the trace id
 * and the name of what failed; the client gets the filter's generic message and
 * nothing about the schema or the row.
 *
 * `what` names the response for the log line — "washer earnings view", not a
 * schema variable name nobody searches for.
 */
export function parseOutgoing<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const traceId = trace.getActiveSpan()?.spanContext().traceId ?? 'untraced';
  logger.error(
    { err: parsed.error, issues: parsed.error.issues, what, traceId },
    'a response failed its own contract',
  );

  throw new InternalServerErrorException(
    {
      error: 'INTERNAL_ERROR',
      message: "Something went wrong on our end. We're looking into it.",
    },
    { cause: parsed.error },
  );
}
