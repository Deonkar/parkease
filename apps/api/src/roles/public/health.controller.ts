import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';

import { Public } from '../../platform/auth/public.decorator.js';
import { env } from '../../platform/config/env.schema.js';
import { DB, type Database } from '../../platform/db/db.module.js';
import { REDIS, type RedisClient } from '../../platform/redis/redis.module.js';

interface ServiceStatus {
  readonly status: 'ok' | 'error';
  readonly error?: string;
}

@Controller('health')
@Public()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  @Get()
  check(): { status: 'ok'; version: string; timestamp: string } {
    return {
      status: 'ok',
      version: env.APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply): Promise<void> {
    const [pg, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);

    const allOk = pg.status === 'ok' && redis.status === 'ok';

    void reply.status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send({
      status: allOk ? 'ok' : 'degraded',
      version: env.APP_VERSION,
      services: { postgres: pg, redis },
    });
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch {
      return { status: 'error', error: 'postgres unreachable' };
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      await this.redis.ping();
      return { status: 'ok' };
    } catch {
      return { status: 'error', error: 'redis unreachable' };
    }
  }
}
