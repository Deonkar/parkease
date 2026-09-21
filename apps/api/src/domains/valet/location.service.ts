import { Inject, Injectable } from '@nestjs/common';
import {
  type ValetLocationUpdate,
  type ValetLocationView,
  valetLocationViewSchema,
} from '@parkease/contracts/valet';

import { logger } from '../../platform/observability/logger.js';
import { REDIS, type RedisClient } from '../../platform/redis/redis.module.js';

/**
 * Short enough that a stale fix expires on its own rather than being served as
 * current. A map showing a two-minute-old position with no indication of age is
 * worse than a map showing nothing.
 */
export const VALET_LOCATION_TTL_SECONDS = 30;

const key = (jobId: string): string => `valet:loc:${jobId}`;

/**
 * Live position is cache, not record.
 *
 * It is never written to Postgres and never logged — not the latitude, not the
 * longitude, not at debug level (security.md §5.3, R-SEC-03). Nothing of value
 * is lost if Redis dies: the stream resumes on the valet's next fix, which is at
 * most a few seconds away (ADR-010).
 */
@Injectable()
export class LocationService {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async record(update: ValetLocationUpdate): Promise<ValetLocationView> {
    const view: ValetLocationView = {
      lat: update.lat,
      lng: update.lng,
      ...(update.headingDeg === undefined ? {} : { headingDeg: update.headingDeg }),
      ...(update.speedKph === undefined ? {} : { speedKph: update.speedKph }),
      at: Date.now(),
    };

    await this.redis.set(key(update.jobId), JSON.stringify(view), 'EX', VALET_LOCATION_TTL_SECONDS);

    return view;
  }

  /**
   * The last fix, or null.
   *
   * Parsed rather than cast on the way out: a cached value is data that left the
   * process and came back, and a key written by an older build — or by hand —
   * must not become a position on a map (R-VAL-01). A malformed value is
   * discarded and logged at warn with the job id, never the coordinates.
   */
  async lastKnown(jobId: string): Promise<ValetLocationView | null> {
    const raw = await this.redis.get(key(jobId));
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn({ jobId }, 'valet location cache held unparseable JSON; discarding');
      return null;
    }

    const result = valetLocationViewSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn({ jobId }, 'valet location cache held a value of the wrong shape; discarding');
      return null;
    }

    return result.data;
  }

  /**
   * The car is parked or the job is over. Stop answering with a stale fix.
   *
   * Handled and logged rather than rethrown, which is the one shape R-FAIL-01
   * allows here and the right one: callers invoke this *after* their transaction
   * commits, so throwing would fail a request whose work already succeeded — the
   * valet would see "could not park the car" for a car that is parked. The key
   * carries a 30-second TTL regardless, so the worst case of a failure is that
   * one stale fix is served for less than half a minute.
   */
  async forget(jobId: string): Promise<void> {
    try {
      await this.redis.del(key(jobId));
    } catch (err: unknown) {
      logger.warn({ err, jobId }, 'could not clear the valet location cache; it will expire');
    }
  }
}
