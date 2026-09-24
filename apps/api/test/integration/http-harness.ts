import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';

import { BookingModule } from '../../src/domains/booking/booking.module.js';
import { CarwashModule } from '../../src/domains/carwash/carwash.module.js';
import { SwitchRoleCommand } from '../../src/domains/identity/commands/switch-role.command.js';
import { RoleRepository } from '../../src/domains/identity/repositories/role.repository.js';
import { UserRepository } from '../../src/domains/identity/repositories/user.repository.js';
import { PaymentModule } from '../../src/domains/payment/payment.module.js';
import { RAZORPAY } from '../../src/domains/payment/razorpay.client.js';
import { PricingModule } from '../../src/domains/pricing/pricing.module.js';
import { SpaceModule } from '../../src/domains/space/space.module.js';
import { SurgeModule } from '../../src/domains/surge/surge.module.js';
import { ValetModule } from '../../src/domains/valet/valet.module.js';
import type { AuthUser } from '../../src/platform/auth/current-user.decorator.js';
import { IS_PUBLIC_KEY } from '../../src/platform/auth/public.decorator.js';
import { TokenService } from '../../src/platform/auth/token.service.js';
import { DB, DbModule } from '../../src/platform/db/db.module.js';
import { AllExceptionsFilter } from '../../src/platform/http/exception.filter.js';
import { TransformInterceptor } from '../../src/platform/http/transform.interceptor.js';
import { IdempotencyInterceptor } from '../../src/platform/idempotency/idempotency.interceptor.js';
import { IdempotencyModule } from '../../src/platform/idempotency/idempotency.module.js';
import { ObservabilityModule } from '../../src/platform/observability/observability.module.js';
import { OutboxModule } from '../../src/platform/outbox/outbox.module.js';
import { ActiveRoleGuard } from '../../src/platform/rbac/active-role.guard.js';
import { RolesGuard } from '../../src/platform/rbac/roles.guard.js';
import { REDIS, RedisModule } from '../../src/platform/redis/redis.module.js';
import { StorageModule } from '../../src/platform/storage/storage.module.js';
import { TelephonyModule } from '../../src/platform/telephony/telephony.module.js';
import { AdminSurgeController } from '../../src/roles/admin/surge.controller.js';
import { DriverBookingsController } from '../../src/roles/driver/bookings.controller.js';
import { DriverCarwashController } from '../../src/roles/driver/carwash.controller.js';
import { DriverPaymentsController } from '../../src/roles/driver/payments.controller.js';
import { DriverQuotesController } from '../../src/roles/driver/quotes.controller.js';
import { DriverSearchController } from '../../src/roles/driver/search.controller.js';
import { DriverValetController } from '../../src/roles/driver/valet.controller.js';
import { OwnerBookingsController } from '../../src/roles/owner/bookings.controller.js';
import { RazorpayWebhookController } from '../../src/roles/public/webhooks/razorpay.controller.js';
import { MeController } from '../../src/roles/shared/me.controller.js';
import { ValetAvailabilityController } from '../../src/roles/valet/availability.controller.js';
import { ValetEarningsController } from '../../src/roles/valet/earnings.controller.js';
import { ValetJobsController } from '../../src/roles/valet/jobs.controller.js';
import { ValetProfileController } from '../../src/roles/valet/profile.controller.js';
import { WasherAvailabilityController } from '../../src/roles/washer/availability.controller.js';
import { WasherEarningsController } from '../../src/roles/washer/earnings.controller.js';
import { WasherJobsController } from '../../src/roles/washer/jobs.controller.js';
import { WasherProfileController } from '../../src/roles/washer/profile.controller.js';
import { WasherServicesController } from '../../src/roles/washer/services.controller.js';

import type { Harness } from './harness.js';

/**
 * Who the next request is from. Set per test rather than minting real JWTs:
 * token issuance is `token-service.spec.ts`'s job, and what these tests need is
 * the *rest* of the request pipeline.
 */
export const actingAs = { user: null as AuthUser | null };

/**
 * Stands in for JwtAuthGuard only.
 *
 * Bootstrapping the real one drags in FirebaseVerifierService, which throws on
 * fake credentials and takes DI down with it (learnings.md), so what it does
 * instead is what JwtAuthGuard does once a token has been verified: attach the
 * user, or refuse the request. `RolesGuard` and `ActiveRoleGuard` below are the
 * real classes — an authorisation test that stubs the authoriser proves nothing
 * about the status code a real caller gets.
 */
@Injectable()
class StubAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (actingAs.user === null) throw new UnauthorizedException('Authentication required.');

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthUser }>();
    request.user = actingAs.user;
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
    // Binds the no-op masked-call provider, so contact resolution in the driver
    // view answers the support path exactly as it does at launch.
    TelephonyModule,
    SpaceModule,
    SurgeModule,
    PricingModule,
    BookingModule,
    PaymentModule,
    // Domain only. The tracking gateway is deliberately absent: it needs
    // AuthModule, which is out of this module because FirebaseVerifierService
    // throws on fake credentials. The controllers depend on
    // ValetTrackingPublisher, which ValetModule provides — so a status push in
    // a test is a no-op with no server attached, exactly as it is at boot.
    ValetModule,
    // Domain only, for the same reason as ValetModule above. The car wash
    // controllers need CarwashModule's commands; nothing in it needs AuthModule.
    CarwashModule,
    // `/me/upload-signature` signs through the real CloudinaryService.
    StorageModule,
  ],
  controllers: [
    AdminSurgeController,
    DriverBookingsController,
    DriverQuotesController,
    DriverSearchController,
    DriverPaymentsController,
    OwnerBookingsController,
    RazorpayWebhookController,
    DriverValetController,
    ValetJobsController,
    ValetAvailabilityController,
    ValetEarningsController,
    ValetProfileController,
    DriverCarwashController,
    WasherJobsController,
    WasherServicesController,
    WasherAvailabilityController,
    WasherEarningsController,
    WasherProfileController,
    MeController,
  ],
  providers: [
    /**
     * `MeController`'s own dependencies, provided one by one rather than by
     * importing `SharedModule`: that pulls in IdentityModule, whose
     * `CreateSessionCommand` needs FirebaseVerifierService (see StubAuthGuard).
     * All four are the real classes; `TokenService` needs only the database and
     * the audit log, both real here.
     */
    TokenService,
    RoleRepository,
    UserRepository,
    SwitchRoleCommand,
    // Registered exactly as AppModule does, and in its order. This is the whole
    // point of these tests: the interceptor and guard stack a real request
    // actually passes through. Only RateLimitModule's guard is absent —
    // `ratelimit-policies.spec.ts` covers the policy table on its own.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: StubAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ActiveRoleGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class HttpTestModule {}

export interface HttpApp {
  readonly app: NestFastifyApplication;
  /** Fires a request through the real Fastify pipeline. No socket needed. */
  request(options: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
    /**
     * Exact bytes to send, bypassing `JSON.stringify`.
     *
     * Required for anything that signs a body: `payload` is re-serialised on the
     * way out, so a test that signs a string and sends it as `payload` signs one
     * byte sequence and transmits another. That the two usually agree is what
     * made v1's bug invisible to its own tests.
     */
    rawPayload?: string;
  }): Promise<{ status: number; body: unknown }>;
}

export async function startHttpApp(h: Harness, razorpay?: unknown): Promise<HttpApp> {
  const moduleRef = await Test.createTestingModule({ imports: [HttpTestModule] })
    .overrideProvider(DB)
    .useValue(h.db)
    .overrideProvider(REDIS)
    .useValue(h.redis.asClient())
    .overrideProvider(RAZORPAY)
    // No network in a test. A double also lets the gateway answer with an amount
    // that disagrees with ours, which is the only way to reach the mismatch path.
    .useValue(razorpay ?? {})
    .compile();

  // `rawBody: true` exactly as main.ts sets it. If these two drift apart, every
  // webhook signature assertion is testing a fiction — which is exactly how v1's
  // `JSON.stringify(req.body)` survived its own test suite.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  app.setGlobalPrefix('api/v1');

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    async request({ method, url, headers = {}, payload, rawPayload }) {
      const outgoing =
        rawPayload !== undefined
          ? { payload: rawPayload }
          : payload === undefined
            ? {}
            : { payload: JSON.stringify(payload) };

      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url,
          headers: { 'content-type': 'application/json', ...headers },
          ...outgoing,
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
