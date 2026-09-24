import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { FastifyRequest } from 'fastify';
import { type Observable, catchError, of, tap, throwError } from 'rxjs';
import { z } from 'zod';

import type { AuthUser } from '../auth/current-user.decorator.js';
import { logger } from '../observability/logger.js';

import { IdempotencyService, hashCanonicalBody } from './idempotency.service.js';

const uuidSchema = z.string().uuid();

/**
 * Every webhook route, not one literal path — matching the prefix the
 * `idempotency_keys_user_or_public_check` constraint uses, so the two cannot
 * drift apart into a route that is exempt here but rejected by the database.
 */
const WEBHOOK_PATH_PREFIX = '/api/v1/webhooks/';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly service: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();

    if (request.method === 'GET' || request.method === 'HEAD') {
      return next.handle();
    }

    // Gateways do not mint ParkEase idempotency keys. A webhook carries its own
    // delivery id, and `WebhookService` claims that in the same table (ADR-011)
    // — so demanding a client UUID here would 400 every Razorpay event before
    // the controller ever saw it.
    if (request.url.startsWith(WEBHOOK_PATH_PREFIX)) {
      return next.handle();
    }

    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !uuidSchema.safeParse(key).success) {
      throw new BadRequestException('This request needs an Idempotency-Key header.');
    }

    // `null`, not the string 'anonymous'. `user_id` is a uuid column, so
    // 'anonymous' failed the insert with 22P02 and surfaced as a 500 on every
    // POST /auth/session and /auth/refresh — the single-flight refresh path
    // rule 9 exists to protect. The database now decides which endpoints may go
    // without an owner (`idempotency_keys_user_or_public_check`).
    const userId = request.user?.id ?? null;
    const requestHash = hashCanonicalBody(request.body);
    const routeUrl = (request.routeOptions as { url?: string } | undefined)?.url ?? request.url;
    const endpoint = `${request.method} ${routeUrl}`;

    const existing = await this.service.claim({
      key,
      userId,
      endpoint,
      requestHash,
    });

    switch (existing.outcome) {
      case 'replay':
        return of(existing.response);

      case 'conflict':
        throw new UnprocessableEntityException(
          'Something changed in that request. Please try again.',
        );

      case 'in_flight':
        // Its own code, not the generic CONFLICT: a client must tell "your
        // first attempt is still running" (keep the key, retry) from a real
        // refusal (drop it). `errorCodeFor` upper-cases `error` into the
        // envelope's code, so an already upper-snake value arrives unchanged.
        throw new ConflictException({
          error: 'REQUEST_IN_FLIGHT',
          message: 'That request is still being processed. Give it a moment.',
        });

      case 'proceed': {
        // Captured now, while the request's span is active: the writes below
        // settle after the handler has returned.
        const traceId = trace.getActiveSpan()?.spanContext().traceId ?? 'untraced';

        /**
         * Detached from the response on purpose — the caller's answer must not
         * wait on, or be changed by, the bookkeeping write. But never
         * unobserved (silent failure H1): a failed write leaves the key
         * unfinished, which `claim` recovers once it is older than
         * `IDEMPOTENCY_IN_FLIGHT_STALE_MS`, and the warning is how anyone finds
         * out it happened. Logged, not swallowed: the key and the trace id are
         * both on the line.
         */
        const observe = (write: Promise<void>, what: 'store' | 'release') => {
          write.catch((error: unknown) => {
            logger.warn(
              { err: error, key, endpoint, traceId },
              `idempotency ${what} failed; the key stays in flight until it goes stale`,
            );
          });
        };

        return next.handle().pipe(
          tap((payload) => {
            observe(this.service.store(key, HttpStatus.OK, payload), 'store');
          }),
          catchError((error: unknown) => {
            observe(this.service.release(key), 'release');
            return throwError(() => error);
          }),
        );
      }
    }
  }
}
