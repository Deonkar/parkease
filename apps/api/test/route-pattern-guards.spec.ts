import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthUser } from '../src/platform/auth/current-user.decorator.js';
import { RateLimitGuard } from '../src/platform/ratelimit/ratelimit.guard.js';
import { ActiveRoleGuard } from '../src/platform/rbac/active-role.guard.js';
import type { RedisClient } from '../src/platform/redis/redis.module.js';

/**
 * SEC-H1 and pentest F1 (task 18a review). Fastify's router decodes a path before matching it,
 * so `/api/v1/admin/ledger/%65xport` reaches the export handler. Both guards used to read the RAW
 * URL: the rate limiter looked the policy up and keyed the bucket on the spelling the client chose
 * (so every encoding variant was a fresh bucket, and the 5/min export fell to ADMIN:*), and the
 * active-role guard read `%61dmin` as "no role segment" and let a driver-active session through.
 *
 * A real Fastify instance, not a hand-built request: what is under test is what the router hands
 * the guards, and a fake request would only restate the assumption.
 */

interface EvalCall {
  readonly key: string;
  readonly limit: number;
}

const calls: EvalCall[] = [];

const fakeRedis = {
  eval: (_script: string, _keys: number, key: string, limit: number) => {
    calls.push({ key, limit });
    return Promise.resolve([1, 0]);
  },
} as unknown as RedisClient;

let actingUser: AuthUser | undefined;

const contextOf = (request: FastifyRequest, reply: FastifyReply): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    getHandler: () => () => undefined,
    getClass: () => Object,
  }) as unknown as ExecutionContext;

describe('guards read the matched route, not the URL the client spelled', () => {
  let app: FastifyInstance;
  const rateLimit = new RateLimitGuard(fakeRedis);
  const activeRole = new ActiveRoleGuard(new Reflector());

  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRequest', (request, _reply, done) => {
      (request as FastifyRequest & { user?: AuthUser | undefined }).user = actingUser;
      done();
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        activeRole.canActivate(contextOf(request, reply));
      } catch {
        return reply.status(403).send({ refused: 'active-role' });
      }
      await rateLimit.canActivate(contextOf(request, reply));
      return { ok: true };
    };

    for (const url of [
      '/api/v1/admin/ledger/export',
      '/api/v1/admin/ledger',
      '/api/v1/admin/partners/:id',
      '/api/v1/admin/users',
    ]) {
      app.get(url, handler);
    }
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
    actingUser = {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      roles: ['admin'],
      activeRole: 'admin',
    };
  });

  it('an encoded spelling of the export resolves to the export policy and shares its bucket', async () => {
    for (const url of [
      '/api/v1/admin/ledger/export',
      '/api/v1/admin/ledger/%65xport',
      '/api/v1/admin/ledger/%65%78port',
      '/api/v1/%61dmin/ledger/export',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }

    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.key)).size, 'one bucket for every spelling').toBe(1);
    expect(calls.every((c) => c.limit === 5)).toBe(true);
  });

  it('two concrete ids on one parameterised route share one bucket', async () => {
    await app.inject({ method: 'GET', url: `/api/v1/admin/partners/${crypto.randomUUID()}` });
    await app.inject({ method: 'GET', url: `/api/v1/admin/partners/${crypto.randomUUID()}` });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.key).toBe(calls[1]?.key);
  });

  it('a percent-encoded role segment is still the admin segment to the active-role check', async () => {
    actingUser = {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
      roles: ['admin', 'driver'],
      activeRole: 'driver',
    };

    for (const url of ['/api/v1/admin/users', '/api/v1/%61dmin/users', '/api/v1/%41dmin/users']) {
      const res = await app.inject({ method: 'GET', url });
      // %41dmin is `Admin`, which matches no route: 404 is as good as 403 here.
      expect([403, 404], url).toContain(res.statusCode);
    }
    expect(calls, 'no refused request reached the rate limiter').toHaveLength(0);
  });
});
