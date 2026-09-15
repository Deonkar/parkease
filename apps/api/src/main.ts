import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { env } from './platform/config/env.schema.js';
import { correlationIdMiddleware } from './platform/http/correlation-id.middleware.js';
import { registerRawBodyParser } from './platform/http/raw-body.js';
import { logger } from './platform/observability/logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true }),
    { logger: false },
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', correlationIdMiddleware);

  // Keeps the raw bytes for the Razorpay webhook route. Registered from the same
  // function the integration HTTP harness uses, so a signature test cannot pass
  // against a body parser that differs from this one.
  registerRawBodyParser(fastify);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'parkease api started');
}

await bootstrap();
