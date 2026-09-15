import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

import { pgSqlState } from '../db/errors.js';
import { logger } from '../observability/logger.js';

interface MappedError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

const PG_ERROR_MAP: Readonly<Record<string, MappedError>> = {
  '23P01': {
    status: HttpStatus.CONFLICT,
    code: 'SLOT_UNAVAILABLE',
    message: 'This spot was just booked by someone else. Try another one.',
  },
  '23505': {
    status: HttpStatus.CONFLICT,
    code: 'ALREADY_EXISTS',
    message: 'That already exists.',
  },
  '23503': {
    status: HttpStatus.BAD_REQUEST,
    code: 'REFERENCE_MISSING',
    message: 'This item is no longer available.',
  },
  '40001': {
    status: HttpStatus.CONFLICT,
    code: 'CONFLICT_RETRY',
    message: 'Something changed while we were saving. Please try again.',
  },
};

/**
 * One issue, named by its field, in the caller's words.
 *
 * Not the whole issue array: a validation dump is a schema disclosure and it is
 * not what a driver's phone should render. The full detail is in the log line
 * the filter writes alongside the trace id (R-GEN-06).
 */
function firstIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'That request was not valid.';
  const field = issue.path.join('.');
  return field === '' ? issue.message : `${field}: ${issue.message}`;
}

function errorCodeFor(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'object' && 'error' in response) {
    return String((response as Record<string, unknown>)['error'])
      .toUpperCase()
      .replace(/\s+/g, '_');
  }
  return 'ERROR';
}

function userMessageFor(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && 'message' in response) {
    const msg = (response as Record<string, unknown>)['message'];
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg)) return msg.join('. ');
  }
  return 'An error occurred.';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const traceId = trace.getActiveSpan()?.spanContext().traceId ?? 'untraced';
    const mapped = this.map(exception);

    logger.error({ err: exception, code: mapped.code, traceId }, 'request failed');

    void reply.status(mapped.status).send({
      error: { code: mapped.code, message: mapped.message, traceId },
    });
  }

  private map(exception: unknown): MappedError {
    const sqlState = pgSqlState(exception);
    if (sqlState) {
      const pgMapped = PG_ERROR_MAP[sqlState];
      if (pgMapped) return pgMapped;
    }

    // A ZodError is not an HttpException, so without this every controller that
    // validates with `schema.parse()` — which is all of them, R-CON-01 — answered
    // 500 for a malformed body instead of 400. It read as "our fault" for what
    // is plainly the caller's, and it hid real client bugs behind an alert.
    // Found by the first HTTP-level test; unreachable from a test that calls a
    // command directly.
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: firstIssueMessage(exception),
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        code: errorCodeFor(exception),
        message: userMessageFor(exception),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: "Something went wrong on our end. We're looking into it.",
    };
  }
}
