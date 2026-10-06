import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { routePattern } from '../http/route-pattern.js';
import { logger } from '../observability/logger.js';
import { REDIS, type RedisClient } from '../redis/redis.module.js';

import { resolvePolicy, type RateLimitPolicy } from './policies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_SCRIPT = readFileSync(join(__dirname, 'token-bucket.lua'), 'utf8');

interface AuthUser {
  readonly id: string;
}

/**
 * Keyed on the matched route (`GET /api/v1/admin/partners/:id`), never the raw URL: a bucket per
 * spelling, or per concrete id, is no limit at all (SEC-H1). The method is part of the key, so a
 * GET and a PUT on one path no longer share a bucket sized by whichever of their policies ran.
 */
function bucketKey(policy: RateLimitPolicy, request: FastifyRequest, route: string): string {
  switch (policy.keyBy) {
    case 'user': {
      const user = (request as FastifyRequest & { user?: AuthUser }).user;
      return `rl:${user?.id ?? request.ip}:${route}`;
    }
    case 'ip':
      return `rl:ip:${request.ip}:${route}`;
    case 'phone': {
      const body = request.body as Record<string, unknown> | undefined;
      const raw = body?.['phone'];
      const phone = typeof raw === 'string' ? raw : request.ip;
      return `rl:phone:${phone}:${route}`;
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const pattern = routePattern(request);
    const policy = resolvePolicy(request.method, pattern);
    const key = bucketKey(policy, request, `${request.method} ${pattern}`);

    try {
      const result = (await this.redis.eval(
        LUA_SCRIPT,
        1,
        key,
        policy.limit,
        policy.windowSeconds,
        Math.floor(Date.now() / 1000),
      )) as [number, number];

      const [allowed, retryAfter] = result;

      if (allowed === 1) return true;

      void reply
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .header('Retry-After', String(retryAfter))
        .send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please wait and try again.',
            traceId: 'untraced',
          },
        });
      return false;
    } catch (err) {
      if (policy.failClosed) {
        logger.error({ err, key }, 'rate limiter failed closed');
        void reply.status(HttpStatus.SERVICE_UNAVAILABLE).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporarily unavailable. Please try again.',
            traceId: 'untraced',
          },
        });
        return false;
      }

      logger.warn({ err, key }, 'rate limiter failed open — redis unreachable');
      return true;
    }
  }
}
