import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { env } from './platform/config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: true }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

await bootstrap();
