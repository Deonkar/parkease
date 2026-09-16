import { Inject, Injectable } from '@nestjs/common';
import {
  NO_SURGE_SNAPSHOT,
  SURGE_KEY_PREFIX,
  surgeKey,
  surgeSnapshotSchema,
  type SurgeSnapshot,
  type ZoneId,
} from '@parkease/contracts/admin';

import { logger } from '../../platform/observability/logger.js';
import { REDIS, type RedisClient } from '../../platform/redis/redis.module.js';

// Re-exported for the tests and callers that already import them from here.
// The definitions live in contracts because the worker writes the keys this
// service reads, and two spellings of the prefix would mean writes and reads
// silently never meeting.
export { SURGE_KEY_PREFIX, surgeKey };

@Injectable()
export class SurgeService {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  /**
   * One MGET over the distinct zones on the page, never one call per space.
   *
   * The whole snapshot comes back, not just its multiplier: the badge is the
   * tier's own name, and a caller that re-derived a tier from the number is how
   * the chip and the price come to disagree. `surgeSnapshotSchema` already
   * refuses a surging snapshot with no badge, so a value that would produce a
   * price the product cannot explain degrades like any other corrupt one.
   *
   * Redis is a cache (ADR-010): a missing, corrupt or unreachable key all mean
   * the same thing — no surge — and none of them fails a search or a booking.
   */
  async multipliersFor(zoneIds: readonly string[]): Promise<Map<ZoneId, SurgeSnapshot>> {
    const distinct = [...new Set(zoneIds)];
    if (distinct.length === 0) return new Map();

    const raw = await this.read(distinct);
    if (raw === undefined) {
      return new Map(distinct.map((zoneId) => [zoneId, NO_SURGE_SNAPSHOT]));
    }

    return new Map(
      distinct.map((zoneId, index) => [zoneId, this.parseSnapshot(zoneId, raw[index])]),
    );
  }

  private async read(zoneIds: readonly ZoneId[]): Promise<(string | null)[] | undefined> {
    try {
      const values = await this.redis.mget(zoneIds.map(surgeKey));
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

  private parseSnapshot(zoneId: ZoneId, value: string | null | undefined): SurgeSnapshot {
    if (value === null || value === undefined) return NO_SURGE_SNAPSHOT;

    let decoded: unknown;
    try {
      decoded = JSON.parse(value);
    } catch (err) {
      logger.warn({ err, zoneId }, 'surge value is not JSON — pricing without surge');
      return NO_SURGE_SNAPSHOT;
    }

    // Cached data crossing a process boundary parses rather than casts
    // (R-VAL-01). The worker wrote it, but the cache is not the worker.
    const snapshot = surgeSnapshotSchema.safeParse(decoded);
    if (!snapshot.success) {
      logger.warn(
        { zoneId, issues: snapshot.error.issues },
        'surge value failed validation — pricing without surge',
      );
      return NO_SURGE_SNAPSHOT;
    }

    return snapshot.data;
  }
}
