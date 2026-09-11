import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { NotificationModule } from './domains/notification/notification.module.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { JwtAuthGuard } from './platform/auth/jwt-auth.guard.js';
import { DbModule } from './platform/db/db.module.js';
import { AllExceptionsFilter } from './platform/http/exception.filter.js';
import { TransformInterceptor } from './platform/http/transform.interceptor.js';
import { IdempotencyInterceptor } from './platform/idempotency/idempotency.interceptor.js';
import { IdempotencyModule } from './platform/idempotency/idempotency.module.js';
import { ObservabilityModule } from './platform/observability/observability.module.js';
import { OutboxModule } from './platform/outbox/outbox.module.js';
import { RateLimitGuard } from './platform/ratelimit/ratelimit.guard.js';
import { RateLimitModule } from './platform/ratelimit/ratelimit.module.js';
import { ActiveRoleGuard } from './platform/rbac/active-role.guard.js';
import { RbacModule } from './platform/rbac/rbac.module.js';
import { RolesGuard } from './platform/rbac/roles.guard.js';
import { RedisModule } from './platform/redis/redis.module.js';
import { PublicModule } from './roles/public/public.module.js';
import { SharedModule } from './roles/shared/shared.module.js';

@Module({
  imports: [
    DbModule,
    RedisModule,
    ObservabilityModule,
    AuthModule,
    RbacModule,
    RateLimitModule,
    IdempotencyModule,
    OutboxModule,
    NotificationModule,
    PublicModule,
    SharedModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ActiveRoleGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
