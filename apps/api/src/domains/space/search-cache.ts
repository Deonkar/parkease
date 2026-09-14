import { Inject, Injectable } from '@nestjs/common';
import type { SearchSpacesQuery } from '@parkease/contracts/driver';
import { amenitySchema } from '@parkease/contracts/enums';
import { spaceScheduleSchema } from '@parkease/contracts/owner';
import { spaceIdSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { geohashEncode } from '../../platform/geo/geohash.js';
import { logger } from '../../platform/observability/logger.js';
import { REDIS, type RedisClient } from '../../platform/redis/redis.module.js';

import { filtersHash } from './search-sql.js';

export const CANDIDATE_CACHE_TTL_SECONDS = 60;

/**
 * Precision 7 is a ~150m x 150m cell, so two drivers sharing a key are within
 * about 80m of each other. Distance badges round to 50m, which keeps the error
 * invisible.
 */
export const CACHE_CELL_PRECISION = 7;

/**
 * Stage 1 output — and *only* stage 1 output.
 *
 * `availableSlots` and `surgeMultiplier` are deliberately absent: availability
 * is computed per request and never cached (R-PERF-05), and surge has its own
 * shorter-lived key. A cache hit still runs the availability probe.
 */
const candidateSchema = z.object({
  id: spaceIdSchema,
  title: z.string(),
  addressLine: z.string(),
  lat: z.number(),
  lng: z.number(),
  distanceM: z.number().int(),
  /** Unrounded, in metres. The distance cursor sorts and compares on this. */
  distanceExactM: z.number(),
  ratingAvgBp: z.number().int().nullable(),
  ratingCount: z.number().int().nonnegative(),
  amenities: z.array(amenitySchema),
  schedule: spaceScheduleSchema,
  basePricePaise: z.number().int().nonnegative(),
  zoneId: z.string(),
  thumbnailUrl: z.string().nullable(),
});

export type Candidate = z.infer<typeof candidateSchema>;

/**
 * The one place a candidate is built, whether it came from SQL or from Redis.
 * Running both paths through the same schema is what guarantees a cache hit and
 * a cache miss produce byte-identical results.
 */
export function parseCandidate(raw: unknown): Candidate {
  return candidateSchema.parse(raw);
}

const cachedCandidatesSchema = z.array(candidateSchema);

@Injectable()
export class SearchCache {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  static keyFor(q: SearchSpacesQuery): string {
    const cell = geohashEncode(q.lat, q.lng, CACHE_CELL_PRECISION);
    return `search:${cell}:${filtersHash(q)}`;
  }

  /**
   * A miss and an unreachable Redis are the same answer: recompute. ADR-010 —
   * Redis is a cache, and a search must still work without it.
   */
  async read(q: SearchSpacesQuery): Promise<Candidate[] | undefined> {
    const key = SearchCache.keyFor(q);

    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      logger.warn({ err, key }, 'candidate cache read failed — recomputing');
      return undefined;
    }

    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn({ err, key }, 'candidate cache entry is not JSON — recomputing');
      return undefined;
    }

    // R-VAL-01: a cached value is data from outside the process. An entry
    // written by an older shape must degrade to a miss, never to a crash.
    const candidates = cachedCandidatesSchema.safeParse(parsed);
    if (!candidates.success) {
      logger.warn(
        { key, issues: candidates.error.issues },
        'candidate cache entry failed validation — recomputing',
      );
      return undefined;
    }

    return candidates.data;
  }

  async write(q: SearchSpacesQuery, candidates: readonly Candidate[]): Promise<void> {
    const key = SearchCache.keyFor(q);
    try {
      await this.redis.set(key, JSON.stringify(candidates), 'EX', CANDIDATE_CACHE_TTL_SECONDS);
    } catch (err) {
      // A cache that cannot be written is a slower search, not a failed one.
      logger.warn({ err, key }, 'candidate cache write failed — continuing uncached');
    }
  }
}
