import { type CanActivate, type ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';

import { BookingModule } from '../../src/domains/booking/booking.module.js';
import { PricingModule } from '../../src/domains/pricing/pricing.module.js';
import { SpaceModule } from '../../src/domains/space/space.module.js';
import { SurgeModule } from '../../src/domains/surge/surge.module.js';
import type { AuthUser } from '../../src/platform/auth/current-user.decorator.js';
import { DB, DbModule } from '../../src/platform/db/db.module.js';
import { AllExceptionsFilter } from '../../src/platform/http/exception.filter.js';
import { TransformInterceptor } from '../../src/platform/http/transform.interceptor.js';
import { IdempotencyInterceptor } from '../../src/platform/idempotency/idempotency.interceptor.js';
import { IdempotencyModule } from '../../src/platform/idempotency/idempotency.module.js';
import { ObservabilityModule } from '../../src/platform/observability/observability.module.js';
import { OutboxModule } from '../../src/platform/outbox/outbox.module.js';
import { REDIS, RedisModule } from '../../src/platform/redis/redis.module.js';
import { DriverBookingsController } from '../../src/roles/driver/bookings.controller.js';
import { DriverQuotesController } from '../../src/roles/driver/quotes.controller.js';
import { DriverSearchController } from '../../src/roles/driver/search.controller.js';
import { OwnerBookingsController } from '../../src/roles/owner/bookings.controller.js';

import type { Harness } from './harness.js';

/**
 * Who the next request is from. Set per test rather than minting real JWTs:
 * token issuance is `token-service.spec.ts`'s job, and what these tests need is
 * the *rest* of the request pipeline.
 */
export const actingAs = { user: null as AuthUser | null };

/**
 * Stands in for JwtAuthGuard, RolesGuard and ActiveRoleGuard.
 *
 * Those three are covered by `rbac-guards.spec.ts` and bootstrapping the real
 * ones drags in FirebaseVerifierService, which throws on fake credentials and
 * takes DI down with it (learnings.md). Everything downstream of authentication
 * — the interceptors, the exception filter, validation, the controllers — is
 * the real thing.
 */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    if (actingAs.user !== null) request.user = actingAs.user;
    return true;
  }
}

/**
 * AppModule's import list minus AuthModule and RateLimitModule.
 *
 * The `@Global()` platform modules are only global once something imports them,
 * so they have to be listed here exactly as AppModule lists them — otherwise
 * `ApprovalService` and friends resolve to `undefined` deep inside SpaceModule.
 * AuthModule is out because FirebaseVerifierService throws on fake credentials
 * (learnings.md); RateLimitModule is out because these tests are not about rate
 * limits and `ratelimit-policies.spec.ts` already covers the policy table.
 */
@Module({
  imports: [
    DbModule,
    RedisModule,
    ObservabilityModule,
    OutboxModule,
    IdempotencyModule,
    SpaceModule,
    SurgeModule,
    PricingModule,
    BookingModule,
  ],
  controllers: [
    DriverBookingsController,
    DriverQuotesController,
    DriverSearchController,
    OwnerBookingsController,
  ],
  providers: [
    // Registered exactly as AppModule does. This is the whole point of these
    // tests: the interceptor stack a real request actually passes through.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: StubAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class HttpTestModule {}

export interface HttpApp {
  readonly app: NestFastifyApplication;
  /** Fires a request through the real Fastify pipeline. No socket needed. */
  request(options: {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<{ status: number; body: unknown }>;
}

export async function startHttpApp(h: Harness): Promise<HttpApp> {
  const moduleRef = await Test.createTestingModule({ imports: [HttpTestModule] })
    .overrideProvider(DB)
    .useValue(h.db)
    .overrideProvider(REDIS)
    .useValue(h.redis.asClient())
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    async request({ method, url, headers = {}, payload }) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url,
          headers: { 'content-type': 'application/json', ...headers },
          ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
        });

      let body: unknown = null;
      try {
        body = response.body === '' ? null : JSON.parse(response.body);
      } catch {
        // A non-JSON body is itself the finding; hand it back as a string
        // rather than swallowing it into null.
        body = response.body;
      }
      return { status: response.statusCode, body };
    },
  };
}

export async function stopHttpApp(http: HttpApp): Promise<void> {
  actingAs.user = null;
  await http.app.close();
}
