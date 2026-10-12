import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { uuidv7 } from '@parkease/db';
import { Redis } from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startRedisContainer } from '../../../../packages/testing/src/redis-container.js';
import { AppModule } from '../../src/app.module.js';
import { FirebaseVerifierService } from '../../src/platform/auth/firebase-verifier.service.js';
import { TokenService } from '../../src/platform/auth/token.service.js';
import { DB } from '../../src/platform/db/db.module.js';
import type { TxHandle } from '../../src/platform/db/transaction.js';
import { REDIS } from '../../src/platform/redis/redis.module.js';

import { type Harness, seedUser, startHarness, stopHarness } from './harness.js';

/**
 * §21.3 #13 (S-153): the rate limiter, driven over HTTP through the real AppModule — the real JWT
 * guard ahead of the real rate-limit guard, as production orders them, over a real Redis (the
 * token bucket is a Lua script a fake cannot run). `ratelimit-policies.spec.ts` checks the table;
 * this checks a request is actually turned away, and by whose bucket.
 */
describe('rate limiting over HTTP', () => {
  let h: Harness;
  let app: NestFastifyApplication;
  let redis: Redis;
  let container: StartedTestContainer;
  let tokens: TokenService;

  beforeAll(async () => {
    h = await startHarness();
    const started = await startRedisContainer();
    container = started.container;
    redis = new Redis(started.url, { maxRetriesPerRequest: 1 });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DB)
      .useValue(h.db)
      .overrideProvider(REDIS)
      .useValue(redis)
      // Constructing the real verifier needs Firebase credentials; no request here signs in.
      .overrideProvider(FirebaseVerifierService)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tokens = app.get(TokenService);
  }, 300_000);

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    await container.stop();
    await stopHarness(h);
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  const driverToken = async (): Promise<string> => {
    const userId = await seedUser(h, 'driver');
    const issued = await h.db.transaction((tx) =>
      tokens.issue(tx as unknown as TxHandle, { userId, roles: ['driver'], activeRole: 'driver' }),
    );
    return issued.accessToken;
  };

  const book = (token: string, ip = '203.0.113.7') =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/v1/driver/bookings',
        remoteAddress: ip,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': uuidv7(),
        },
        // Refused as invalid after the guard: the bucket counts attempts, not successes.
        payload: '{}',
      });

  it('lets ten bookings a minute through and answers the eleventh 429 with Retry-After', async () => {
    const token = await driverToken();

    const first = [];
    for (let i = 0; i < 10; i += 1) first.push(await book(token));
    const eleventh = await book(token);

    expect(first.map((r) => r.statusCode)).not.toContain(429);
    expect(eleventh.statusCode).toBe(429);
    expect((eleventh.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(eleventh.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('keys the bucket by user, so drivers behind one carrier NAT do not share a limit', async () => {
    const first = await driverToken();
    for (let i = 0; i < 11; i += 1) await book(first);

    // Same IP, another driver.
    expect((await book(await driverToken())).statusCode).not.toBe(429);
  });
});
