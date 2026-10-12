import { HttpStatus } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { OutboxLagQuery } from '../src/platform/outbox/outbox-lag.query.js';
import { HealthController } from '../src/roles/public/health.controller.js';

describe('HealthController', () => {
  it('GET /health returns flat shape (not wrapped)', () => {
    const controller = new HealthController({} as never, {} as never, {} as never);
    const result = controller.check();

    expect(result).toEqual({
      status: 'ok',
      version: expect.any(String),
      timestamp: expect.any(String),
    });

    expect(Object.keys(result)).toHaveLength(3);
    expect(result).not.toHaveProperty('data');
  });

  it('GET /health/ready returns 200 when PG + Redis are ok', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const controller = new HealthController(db as never, redis as never, {} as never);

    let sentBody: unknown;
    const reply = {
      status: vi.fn().mockReturnValue({
        send: vi.fn((body: unknown) => {
          sentBody = body;
        }),
      }),
    };

    await controller.ready(reply as never);
    const sentStatus = reply.status.mock.calls[0]?.[0] as number;

    expect(sentStatus).toBe(HttpStatus.OK);
    expect(sentBody).toEqual(
      expect.objectContaining({
        status: 'ok',
        services: {
          postgres: { status: 'ok' },
          redis: { status: 'ok' },
        },
      }),
    );
  });

  it('GET /health/ready returns 503 when Redis is down', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };
    const redis = { ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const controller = new HealthController(db as never, redis as never, {} as never);

    let sentBody: Record<string, unknown> | undefined;
    const reply = {
      status: vi.fn().mockReturnValue({
        send: vi.fn((body: Record<string, unknown>) => {
          sentBody = body;
        }),
      }),
    };

    await controller.ready(reply as never);
    const sentStatus = reply.status.mock.calls[0]?.[0] as number;

    expect(sentStatus).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(sentBody).toEqual(expect.objectContaining({ status: 'degraded' }));
  });

  /** S-156: an uptime probe sees a stalled or dead worker from outside it. */
  describe('GET /health/pipeline', () => {
    const probe = async (lag: number | null) => {
      const db = { execute: vi.fn().mockResolvedValue([{ lag }]) };
      const controller = new HealthController(
        {} as never,
        {} as never,
        new OutboxLagQuery(db as never),
      );
      let sentBody: unknown;
      const reply = {
        status: vi.fn().mockReturnValue({
          send: vi.fn((body: unknown) => {
            sentBody = body;
          }),
        }),
      };
      await controller.pipeline(reply as never);
      return { status: reply.status.mock.calls[0]?.[0] as number, body: sentBody };
    };

    it('is 200 with no backlog', async () => {
      expect(await probe(null)).toEqual({
        status: HttpStatus.OK,
        body: { status: 'ok', outboxLagSeconds: 0, budgetSeconds: 30 },
      });
    });

    it('is 503 once the oldest ready message is past its budget', async () => {
      expect(await probe(95.4)).toEqual({
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: { status: 'lagging', outboxLagSeconds: 95, budgetSeconds: 30 },
      });
    });
  });
});
