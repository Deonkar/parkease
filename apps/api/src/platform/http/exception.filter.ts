import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { FastifyReply } from 'fastify';

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

function extractSqlState(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as Record<string, unknown>)['code'] === 'string'
  ) {
    return (error as Record<string, unknown>)['code'] as string;
  }
  return undefined;
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
    const sqlState = extractSqlState(exception);
    if (sqlState) {
      const pgMapped = PG_ERROR_MAP[sqlState];
      if (pgMapped) return pgMapped;
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
