import { Inject, Injectable } from '@nestjs/common';
import { SURGE_MULTIPLIER_MAX, SURGE_MULTIPLIER_MIN } from '@parkease/contracts/money';
import { z } from 'zod';

import { logger } from '../../platform/observability/logger.js';
import { REDIS, type RedisClient } from '../../platform/redis/redis.module.js';

export const SURGE_KEY_PREFIX = 'surge:';

/** No surge key, no surge. This is the value every degraded path returns. */
export const NO_SURGE = 1;

/**
 * The value task 10's worker writes. Only `multiplier` is read here; the rest
 * of the record is task 10's to shape. It is cached, third-party-shaped data,
 * so it parses through a schema rather than being cast (R-VAL-01) — and the
 * range bound is load-bearing: a corrupt 9x would otherwise be charged.
 */
const surgeRecordSchema = z.object({
  multiplier: z.number().min(SURGE_MULTIPLIER_MIN).max(SURGE_MULTIPLIER_MAX),
});

@Injectable()
export class SurgeService {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  /**
   * One MGET over the distinct zones on the page, never one call per space.
   *
   * Redis is a cache (ADR-010): an empty, corrupt or unreachable Redis degrades
   * to base pricing and never fails the search.
   */
  async multipliersFor(zoneIds: readonly string[]): Promise<Map<string, number>> {
    const distinct = [...new Set(zoneIds)];
    if (distinct.length === 0) return new Map();

    const raw = await this.read(distinct);
    if (raw === undefined) {
      return new Map(distinct.map((zoneId) => [zoneId, NO_SURGE]));
    }

    return new Map(
      distinct.map((zoneId, index) => [zoneId, this.parseMultiplier(zoneId, raw[index])]),
    );
  }

  private async read(zoneIds: readonly string[]): Promise<(string | null)[] | undefined> {
    try {
      const values = await this.redis.mget(zoneIds.map((id) => `${SURGE_KEY_PREFIX}${id}`));
      if (!Array.isArray(values)) {
        logger.warn({ zoneCount: zoneIds.length }, 'surge MGET returned a non-array — no surge');
        return undefined;
      }
      return values;
    } catch (err) {
      // ADR-010: degrade to base pricing, never fail the search. The logger's
      // mixin attaches the active trace id (R-FAIL-01).
      logger.warn(
        { err, zoneCount: zoneIds.length },
        'surge lookup failed — pricing without surge',
      );
      return undefined;
    }
  }

  private parseMultiplier(zoneId: string, value: string | null | undefined): number {
    if (value === null || value === undefined) return NO_SURGE;

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      logger.warn({ err, zoneId }, 'surge value is not JSON — pricing without surge');
      return NO_SURGE;
    }

    const record = surgeRecordSchema.safeParse(parsed);
    if (!record.success) {
      logger.warn(
        { zoneId, issues: record.error.issues },
        'surge value failed validation — pricing without surge',
      );
      return NO_SURGE;
    }

    return record.data.multiplier;
  }
}
