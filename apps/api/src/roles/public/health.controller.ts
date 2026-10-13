import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';

import { Public } from '../../platform/auth/public.decorator.js';
import { env } from '../../platform/config/env.schema.js';
import { DB, type Database } from '../../platform/db/db.module.js';
import {
  OUTBOX_LAG_BUDGET_SECONDS,
  OutboxLagQuery,
} from '../../platform/outbox/outbox-lag.query.js';
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
    private readonly outboxLag: OutboxLagQuery,
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

  /**
   * The async pipeline, seen from outside the worker (S-156). The worker alerts on outbox lag
   * itself, but a dead worker alerts on nothing; an uptime probe on this route pages instead.
   * 503 past the budget, so any HTTP monitor can watch it. Deliberately not part of `/ready`:
   * a stalled worker must not take the API out of the load balancer.
   *
   * Public like the rest of `/health`, and it reports one number: no ids, no payloads.
   */
  @Get('pipeline')
  async pipeline(@Res() reply: FastifyReply): Promise<void> {
    const lagSeconds = await this.outboxLag.seconds();
    const lagging = lagSeconds > OUTBOX_LAG_BUDGET_SECONDS;

    void reply.status(lagging ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK).send({
      status: lagging ? 'lagging' : 'ok',
      outboxLagSeconds: lagSeconds,
      budgetSeconds: OUTBOX_LAG_BUDGET_SECONDS,
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
