import { Module } from '@nestjs/common';

import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IdempotencyService } from './idempotency.service.js';

@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class IdempotencyModule {}
