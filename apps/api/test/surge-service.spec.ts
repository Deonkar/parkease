import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SURGE_KEY_PREFIX, SurgeService } from '../src/domains/surge/surge.service.js';
import { logger } from '../src/platform/observability/logger.js';
import type { RedisClient } from '../src/platform/redis/redis.module.js';

interface FakeRedis {
  mget: ReturnType<typeof vi.fn>;
}

function serviceWith(mget: ReturnType<typeof vi.fn>): {
  service: SurgeService;
  redis: FakeRedis;
} {
  const redis: FakeRedis = { mget };
  return { service: new SurgeService(redis as unknown as RedisClient), redis };
}

function surgeValue(multiplier: number): string {
  return JSON.stringify({
    multiplier,
    tier: 'high_demand',
    calculatedAt: '2026-09-06T10:00:00.000Z',
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SurgeService.multipliersFor', () => {
  it('returns an empty map without touching Redis when there are no zones', async () => {
    const mget = vi.fn();
    const { service } = serviceWith(mget);

    expect(await service.multipliersFor([])).toEqual(new Map());
    expect(mget).not.toHaveBeenCalled();
  });

  it('reads every zone in exactly one MGET, prefixed by surge:', async () => {
    const mget = vi.fn().mockResolvedValue([null, null]);
    const { service } = serviceWith(mget);

    await service.multipliersFor(['tdr1vk', 'tdr1vm']);

    expect(mget).toHaveBeenCalledTimes(1);
    expect(mget).toHaveBeenCalledWith([`${SURGE_KEY_PREFIX}tdr1vk`, `${SURGE_KEY_PREFIX}tdr1vm`]);
  });

  it('issues one key per distinct zone even if the caller repeats one', async () => {
    const mget = vi.fn().mockResolvedValue([null]);
    const { service } = serviceWith(mget);

    await service.multipliersFor(['tdr1vk', 'tdr1vk', 'tdr1vk']);

    expect(mget).toHaveBeenCalledWith([`${SURGE_KEY_PREFIX}tdr1vk`]);
  });

  it('returns 1.0 for a zone with no surge key — an empty Redis means no surge', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([null]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(new Map([['tdr1vk', 1]]));
  });

  it('returns the written multiplier for a zone that has one', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([surgeValue(1.5)]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(new Map([['tdr1vk', 1.5]]));
  });

  it('maps each value back to its own zone', async () => {
    const { service } = serviceWith(
      vi.fn().mockResolvedValue([surgeValue(1.5), null, surgeValue(2)]),
    );

    expect(await service.multipliersFor(['a1', 'b2', 'c3'])).toEqual(
      new Map([
        ['a1', 1.5],
        ['b2', 1],
        ['c3', 2],
      ]),
    );
  });

  it('falls back to 1.0 and warns on a value that is not the surge shape', async () => {
    const { service } = serviceWith(
      vi.fn().mockResolvedValue(['not json at all', JSON.stringify({ tier: 'high_demand' })]),
    );

    expect(await service.multipliersFor(['a1', 'b2'])).toEqual(
      new Map([
        ['a1', 1],
        ['b2', 1],
      ]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('rejects an out-of-range multiplier rather than charging it', async () => {
    // The contract caps surge at 3x. A 9x value is corrupt data, and failing
    // safe means the driver pays base price, not nine times it.
    const { service } = serviceWith(vi.fn().mockResolvedValue([surgeValue(9), surgeValue(0.2)]));

    expect(await service.multipliersFor(['a1', 'b2'])).toEqual(
      new Map([
        ['a1', 1],
        ['b2', 1],
      ]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('degrades to base pricing with one warning when Redis is unreachable', async () => {
    // ADR-010: Redis is a cache. It being down must never fail a search.
    const { service } = serviceWith(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    expect(await service.multipliersFor(['a1', 'b2'])).toEqual(
      new Map([
        ['a1', 1],
        ['b2', 1],
      ]),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('degrades to base pricing when Redis returns a short array', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([surgeValue(1.5)]));

    expect(await service.multipliersFor(['a1', 'b2'])).toEqual(
      new Map([
        ['a1', 1.5],
        ['b2', 1],
      ]),
    );
  });

  it('degrades to base pricing when Redis returns something that is not an array', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue('nonsense'));

    expect(await service.multipliersFor(['a1'])).toEqual(new Map([['a1', 1]]));
    expect(warn).toHaveBeenCalled();
  });
});
