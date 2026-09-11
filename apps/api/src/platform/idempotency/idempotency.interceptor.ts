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
import type { FastifyRequest } from 'fastify';
import { type Observable, catchError, of, tap, throwError } from 'rxjs';
import { z } from 'zod';

import type { AuthUser } from '../auth/current-user.decorator.js';

import { IdempotencyService, hashCanonicalBody } from './idempotency.service.js';

const uuidSchema = z.string().uuid();

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly service: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();

    if (request.method === 'GET' || request.method === 'HEAD') {
      return next.handle();
    }

    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !uuidSchema.safeParse(key).success) {
      throw new BadRequestException('This request needs an Idempotency-Key header.');
    }

    const userId = request.user?.id ?? 'anonymous';
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
        throw new ConflictException('That request is still being processed. Give it a moment.');

      case 'proceed':
        return next.handle().pipe(
          tap((payload) => {
            void this.service.store(key, HttpStatus.OK, payload);
          }),
          catchError((error: unknown) => {
            void this.service.release(key);
            return throwError(() => error);
          }),
        );
    }
  }
}
