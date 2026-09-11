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

import { logger } from '../observability/logger.js';
import { REDIS, type RedisClient } from '../redis/redis.module.js';

import { DEFAULT_POLICY, RATE_LIMIT_POLICIES, type RateLimitPolicy } from './policies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_SCRIPT = readFileSync(join(__dirname, 'token-bucket.lua'), 'utf8');

interface AuthUser {
  readonly id: string;
}

function resolvePolicy(method: string, url: string): RateLimitPolicy {
  const pathOnly = url.split('?')[0] ?? url;
  const routeKey = `${method} ${pathOnly}`;

  for (const [pattern, policy] of Object.entries(RATE_LIMIT_POLICIES)) {
    if (routeKey === pattern || routeKey.startsWith(pattern.replace(':*', ''))) {
      return policy;
    }
  }

  if (pathOnly.startsWith('/api/v1/admin')) return RATE_LIMIT_POLICIES['ADMIN:*'] ?? DEFAULT_POLICY;

  return DEFAULT_POLICY;
}

function bucketKey(policy: RateLimitPolicy, request: FastifyRequest): string {
  const pathOnly = request.url.split('?')[0] ?? request.url;
  switch (policy.keyBy) {
    case 'user': {
      const user = (request as FastifyRequest & { user?: AuthUser }).user;
      return `rl:${user?.id ?? request.ip}:${pathOnly}`;
    }
    case 'ip':
      return `rl:ip:${request.ip}:${pathOnly}`;
    case 'phone': {
      const body = request.body as Record<string, unknown> | undefined;
      const raw = body?.['phone'];
      const phone = typeof raw === 'string' ? raw : request.ip;
      return `rl:phone:${phone}:${pathOnly}`;
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const policy = resolvePolicy(request.method, request.url);
    const key = bucketKey(policy, request);

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
