import { searchSpacesQuerySchema, type SearchSpacesQuery } from '@parkease/contracts/driver';
import { spaceIdSchema } from '@parkease/contracts/primitives';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_CACHE_TTL_SECONDS,
  SearchCache,
  type Candidate,
} from '../src/domains/space/search-cache.js';
import { filtersHash } from '../src/domains/space/search-sql.js';
import { logger } from '../src/platform/observability/logger.js';
import type { RedisClient } from '../src/platform/redis/redis.module.js';

function query(overrides: Record<string, unknown> = {}): SearchSpacesQuery {
  return searchSpacesQuerySchema.parse({ lat: 12.9345, lng: 77.6266, ...overrides });
}

const candidate: Candidate = {
  id: spaceIdSchema.parse('0192f1b3-0000-7000-8000-000000000001'),
  title: 'Basement Parking',
  addressLine: '5th Cross, Koramangala',
  lat: 12.9349,
  lng: 77.627,
  distanceM: 450,
  distanceExactM: 450.25,
  ratingAvgBp: 42_000,
  ratingCount: 18,
  amenities: ['covered', 'cctv'],
  schedule: { is24x7: true },
  basePricePaise: 3000,
  zoneId: 'tdr1vk',
  thumbnailUrl: 'https://example.test/a.jpg',
};

interface FakeRedis {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
}

function cacheWith(redis: Partial<FakeRedis> = {}): { cache: SearchCache; redis: FakeRedis } {
  const fake: FakeRedis = {
    get: redis.get ?? vi.fn().mockResolvedValue(null),
    set: redis.set ?? vi.fn().mockResolvedValue('OK'),
  };
  return { cache: new SearchCache(fake as unknown as RedisClient), redis: fake };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchCache key', () => {
  it('is search:{geohash7}:{filtersHash}', () => {
    const q = query();
    const key = SearchCache.keyFor(q);
    const [prefix, cell, hash] = key.split(':');

    expect(prefix).toBe('search');
    expect(cell).toHaveLength(7);
    expect(hash).toBe(filtersHash(q));
  });

  it('shares a key between two drivers in the same ~150m cell', () => {
    // Roughly 20m apart.
    expect(SearchCache.keyFor(query({ lat: 12.93452, lng: 77.62662 }))).toBe(
      SearchCache.keyFor(query({ lat: 12.9345, lng: 77.6266 })),
    );
  });

  it('separates drivers in different cells', () => {
    expect(SearchCache.keyFor(query({ lat: 12.97, lng: 77.59 }))).not.toBe(
      SearchCache.keyFor(query()),
    );
  });

  it('separates different filter sets at the same origin', () => {
    expect(SearchCache.keyFor(query({ minRating: '4' }))).not.toBe(SearchCache.keyFor(query()));
  });
});

describe('SearchCache.read', () => {
  it('returns undefined on a miss', async () => {
    const { cache } = cacheWith({ get: vi.fn().mockResolvedValue(null) });
    expect(await cache.read(query())).toBeUndefined();
  });

  it('round-trips what was written', async () => {
    const store = new Map<string, string>();
    const { cache } = cacheWith({
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
    });

    const q = query();
    await cache.write(q, [candidate]);
    // An entry remembers the origin its distances were measured from, so the
    // cursor issued from a hit can continue from that same point.
    expect(await cache.read(q)).toEqual({
      origin: { lat: q.lat, lng: q.lng },
      candidates: [candidate],
    });
  });

  it('treats a cached value that fails validation as a miss, and warns', async () => {
    // R-VAL-01: a cached value is data from outside the process. A schema
    // change that leaves old entries in Redis must not crash a search.
    const { cache } = cacheWith({
      get: vi.fn().mockResolvedValue(JSON.stringify([{ id: 'not-a-uuid' }])),
    });

    expect(await cache.read(query())).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('treats unparseable JSON as a miss, and warns', async () => {
    const { cache } = cacheWith({ get: vi.fn().mockResolvedValue('{not json') });

    expect(await cache.read(query())).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('treats an unreachable Redis as a miss rather than an error', async () => {
    // ADR-010: Redis is a cache. A search must still work without it.
    const { cache } = cacheWith({ get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    expect(await cache.read(query())).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('SearchCache.write', () => {
  it('writes under the query key with a 60 second TTL', async () => {
    const { cache, redis } = cacheWith();
    const q = query();

    await cache.write(q, [candidate]);

    expect(CANDIDATE_CACHE_TTL_SECONDS).toBe(60);
    expect(redis.set).toHaveBeenCalledWith(
      SearchCache.keyFor(q),
      JSON.stringify({ origin: { lat: q.lat, lng: q.lng }, candidates: [candidate] }),
      'EX',
      CANDIDATE_CACHE_TTL_SECONDS,
    );
  });

  it('swallows nothing but still resolves when Redis is unreachable', async () => {
    const { cache } = cacheWith({ set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    await expect(cache.write(query(), [candidate])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
