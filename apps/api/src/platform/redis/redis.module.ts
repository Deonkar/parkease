import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { env } from '../config/env.schema.js';
import { logger } from '../observability/logger.js';

export const REDIS = Symbol('REDIS');

export type RedisClient = Redis;

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  logger.warn({ err }, 'redis connection error');
});

@Global()
@Module({
  providers: [{ provide: REDIS, useValue: redis }],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await redis.quit();
  }
}
