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
    // This attempt's claim token: `store` and `release` carry it back, so a
    // write from an attempt a newer retry has taken over lands on nothing.
    const claimedAt = new Date();

    const existing = await this.service.claim({
      key,
      userId,
      endpoint,
      requestHash,
      claimedAt,
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

        const logged = { key, endpoint, traceId };

        /**
         * Detached from the response on purpose — the caller's answer must not
         * wait on, or be changed by, the bookkeeping write. But never
         * unobserved (silent failure H1): a failed write leaves the key
         * unfinished, which `claim` recovers once it is older than
         * `IDEMPOTENCY_IN_FLIGHT_STALE_MS`, and the warning is how anyone finds
         * out it happened. Logged, not swallowed: the key and the trace id are
         * both on every line.
         *
         * `false` is not a failure but a lost claim: almost always this attempt
         * ran past the threshold and a newer retry holds the key now; otherwise
         * the key was deleted under it. Nothing was written, and retrying would
         * only lose again, so it is logged and left.
         */
        const observe = (write: Promise<boolean>, what: 'store' | 'release') => {
          write.then(
            (held) => {
              if (!held) {
                logger.warn(
                  logged,
                  `idempotency ${what} matched no claim; a newer retry took the key over, or the key is gone`,
                );
              }
            },
            (error: unknown) => {
              logger.warn(
                { err: error, ...logged },
                what === 'store'
                  ? 'idempotency store failed twice; the key stays in flight until it goes stale'
                  : 'idempotency release failed; the key stays in flight until it goes stale',
              );
            },
          );
        };

        /**
         * A store is retried once, a release is not. The handler has already
         * run when `store` is called, so a key left unstored is the path by
         * which a committed write re-runs once the key goes stale (see
         * `IDEMPOTENCY_IN_FLIGHT_STALE_MS`) — worth a second attempt at a
         * transient failure. A failed release only delays the retry of a
         * request that failed anyway.
         */
        const store = (payload: unknown): Promise<boolean> => {
          const attempt = () => this.service.store(key, HttpStatus.OK, payload, claimedAt);
          return attempt().catch((error: unknown) => {
            logger.warn({ err: error, ...logged }, 'idempotency store failed; retrying once');
            return attempt();
          });
        };

        return next.handle().pipe(
          tap((payload) => {
            observe(store(payload), 'store');
          }),
          catchError((error: unknown) => {
            observe(this.service.release(key, claimedAt), 'release');
            return throwError(() => error);
          }),
        );
      }
    }
  }
}
