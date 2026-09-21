import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { env } from './platform/config/env.schema.js';
import { correlationIdMiddleware } from './platform/http/correlation-id.middleware.js';
import { logger } from './platform/observability/logger.js';
import { RedisIoAdapter } from './platform/realtime/redis-io.adapter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true }),
    // Keeps the bytes a request arrived as, so the Razorpay webhook can verify
    // its HMAC over them rather than over a re-serialisation. See
    // platform/http/raw-body.ts for why this flag and not our own parser.
    { logger: false, rawBody: true },
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', correlationIdMiddleware);

  /**
   * Socket.IO rooms, shared across instances.
   *
   * Connected before `listen`, and deliberately not guarded by a try/catch: an
   * API that starts without the Redis adapter serves valet tracking that works
   * on one instance and silently drops every message crossing to another. Dying
   * at boot is the visible failure; starting is the invisible one (ADR-010).
   */
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'parkease api started');
}

await bootstrap();
