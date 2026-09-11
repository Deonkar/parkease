import { Module } from '@nestjs/common';

import { RateLimitGuard } from './ratelimit.guard.js';

@Module({
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RateLimitModule {}
