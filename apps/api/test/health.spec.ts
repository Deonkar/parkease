import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { AppModule } from '../src/app.module.js';

describe('GET /api/v1/health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with the correct shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(res.body).toEqual({
      status: 'ok',
      version: expect.any(String),
      timestamp: expect.any(String),
    });

    expect(Object.keys(res.body)).toHaveLength(3);

    const ts = new Date(res.body.timestamp);
    expect(ts.getTime()).not.toBeNaN();
    expect(Math.abs(Date.now() - ts.getTime())).toBeLessThan(5000);
  });
});
