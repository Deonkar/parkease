import { NO_SURGE_BP, NO_SURGE_SNAPSHOT, type SurgeSnapshot } from '@parkease/contracts/admin';
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

const HIGH_DEMAND_BP = 15_000;
const VERY_HIGH_DEMAND_BP = 20_000;
const CALCULATED_AT = '2026-09-06T10:00:00.000Z';

function snapshot(overrides: Partial<SurgeSnapshot> = {}): SurgeSnapshot {
  return {
    multiplierBp: HIGH_DEMAND_BP,
    badge: 'high_demand',
    occupancyBp: 8_000,
    appliedModifiers: [],
    calculatedAt: CALCULATED_AT,
    ...overrides,
  };
}

const written = (overrides: Partial<SurgeSnapshot> = {}): string =>
  JSON.stringify(snapshot(overrides));

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

  it('returns the no-surge snapshot for a zone with no key', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([null]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
  });

  it('returns the whole written snapshot, not just its multiplier', async () => {
    // The badge travels with the number. A caller deriving a tier from the
    // multiplier is how the chip and the price drift apart.
    const { service } = serviceWith(vi.fn().mockResolvedValue([written()]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(new Map([['tdr1vk', snapshot()]]));
  });

  it('keeps the applied modifiers the worker recorded', async () => {
    const { service } = serviceWith(
      vi.fn().mockResolvedValue([written({ appliedModifiers: ['peak_hour', 'weekend'] })]),
    );

    const result = await service.multipliersFor(['tdr1vk']);

    expect(result.get('tdr1vk')?.appliedModifiers).toEqual(['peak_hour', 'weekend']);
  });

  it('maps each snapshot back to its own zone', async () => {
    const { service } = serviceWith(
      vi
        .fn()
        .mockResolvedValue([
          written(),
          null,
          written({ multiplierBp: VERY_HIGH_DEMAND_BP, badge: 'very_high_demand' }),
        ]),
    );

    expect(await service.multipliersFor(['tdr1va', 'tdr1vb', 'tdr1vc'])).toEqual(
      new Map([
        ['tdr1va', snapshot()],
        ['tdr1vb', NO_SURGE_SNAPSHOT],
        ['tdr1vc', snapshot({ multiplierBp: VERY_HIGH_DEMAND_BP, badge: 'very_high_demand' })],
      ]),
    );
  });

  it('degrades a value that is not JSON to no surge, and warns', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue(['not json at all']));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('degrades a value that is not the snapshot shape to no surge, and warns', async () => {
    const { service } = serviceWith(
      vi.fn().mockResolvedValue([JSON.stringify({ multiplier: 1.5, tier: 'high_demand' })]),
    );

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a surging snapshot that names no tier', async () => {
    // A price the product has no words for is corrupt, and corrupt means no
    // surge. This is the invariant that stops v1's bare multipliers returning.
    const { service } = serviceWith(vi.fn().mockResolvedValue([written({ badge: null })]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('rejects an out-of-range multiplier rather than charging it', async () => {
    const { service } = serviceWith(
      vi.fn().mockResolvedValue([written({ multiplierBp: 90_000 }), written({ multiplierBp: 100 })]),
    );

    expect(await service.multipliersFor(['tdr1va', 'tdr1vb'])).toEqual(
      new Map([
        ['tdr1va', NO_SURGE_SNAPSHOT],
        ['tdr1vb', NO_SURGE_SNAPSHOT],
      ]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('rejects a fractional multiplier — basis points are integers', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([written({ multiplierBp: 15_000.5 })]));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
  });

  it('degrades to no surge with one warning when Redis is unreachable', async () => {
    // ADR-010: Redis is a cache. It being down must never fail a search.
    const { service } = serviceWith(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    expect(await service.multipliersFor(['tdr1va', 'tdr1vb'])).toEqual(
      new Map([
        ['tdr1va', NO_SURGE_SNAPSHOT],
        ['tdr1vb', NO_SURGE_SNAPSHOT],
      ]),
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('degrades the zones a short MGET did not answer for', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([written()]));

    expect(await service.multipliersFor(['tdr1va', 'tdr1vb'])).toEqual(
      new Map([
        ['tdr1va', snapshot()],
        ['tdr1vb', NO_SURGE_SNAPSHOT],
      ]),
    );
  });

  it('degrades to no surge when Redis returns something that is not an array', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue('nonsense'));

    expect(await service.multipliersFor(['tdr1vk'])).toEqual(
      new Map([['tdr1vk', NO_SURGE_SNAPSHOT]]),
    );
    expect(warn).toHaveBeenCalled();
  });

  it('never returns a multiplier below the 1.0x floor', async () => {
    const { service } = serviceWith(vi.fn().mockResolvedValue([null, written()]));

    for (const snap of (await service.multipliersFor(['tdr1va', 'tdr1vb'])).values()) {
      expect(snap.multiplierBp).toBeGreaterThanOrEqual(NO_SURGE_BP);
    }
  });
});
