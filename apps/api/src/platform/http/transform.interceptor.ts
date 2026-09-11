import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type Observable, map } from 'rxjs';

interface PagedPayload {
  readonly items: unknown[];
  readonly meta: Record<string, unknown>;
}

function isPaged(payload: unknown): payload is PagedPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'items' in payload &&
    Array.isArray((payload as PagedPayload).items) &&
    'meta' in payload
  );
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (request.url.startsWith('/api/v1/health')) return next.handle();

    return next.handle().pipe(
      map((payload: unknown) => {
        if (isPaged(payload)) return { data: payload.items, meta: payload.meta };
        return { data: payload };
      }),
    );
  }
}
