import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { SearchSpacesQuery } from '@parkease/contracts/driver';
import { sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import { SurgeService } from '../surge/surge.service.js';

import { isOpenAt } from './schedule.js';
import { parseCandidate, SearchCache, type Candidate } from './search-cache.js';
import {
  basePriceExpr,
  buildConditions,
  cursorCondition,
  decodeCursor,
  DISCOVERY_WINDOW,
  encodeCursor,
  LIVE_SLOT_STATUSES,
  orderByExpr,
  originPoint,
  type SearchCursor,
} from './search-sql.js';

export interface SlotAvailability {
  readonly car: number;
  readonly twoWheeler: number;
}

export interface SearchResult {
  readonly candidate: Candidate;
  readonly availableSlots: SlotAvailability;
  readonly surgeMultiplier: number;
  readonly isOpenNow: boolean;
}

export interface SearchPage {
  readonly items: SearchResult[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

const NO_AVAILABILITY: SlotAvailability = { car: 0, twoWheeler: 0 };

/**
 * Rows come back from raw SQL, so numerics are normalised on the way in —
 * `::bigint` and `count(*)` arrive as strings from postgres-js — and the result
 * goes through the same schema the cache uses, so a hit and a miss cannot drift
 * apart.
 */
function toCandidate(row: Record<string, unknown>): Candidate {
  return parseCandidate({
    id: row['id'],
    title: row['title'],
    addressLine: row['address_line'],
    lat: Number(row['lat']),
    lng: Number(row['lng']),
    distanceM: Number(row['distance_m']),
    distanceExactM: Number(row['distance_exact']),
    ratingAvgBp: row['rating_avg_bp'] === null ? null : Number(row['rating_avg_bp']),
    ratingCount: Number(row['rating_count']),
    // jsonb columns arrive already decoded.
    amenities: row['amenities'],
    schedule: row['schedule'],
    basePricePaise: Number(row['base_price_paise']),
    zoneId: row['zone_id'],
    thumbnailUrl: row['thumbnail_url'] ?? null,
  });
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: SearchCache,
    private readonly surge: SurgeService,
  ) {}

  /**
   * Three stages, in this order, because each has a different caching rule:
   *
   *   1. candidates    spatial + every filter + sort + cursor — cacheable 60s
   *   2. availability  free slots right now — NEVER cached (R-PERF-05)
   *   3. surge         one MGET over the distinct zones on the page
   *
   * Exactly two SQL statements on a cache miss, one on a hit (R-PERF-02).
   */
  async findNearby(q: SearchSpacesQuery): Promise<SearchPage> {
    const fetched = await this.candidates(q);

    const page = fetched.slice(0, q.limit);
    const hasMore = fetched.length > q.limit;
    const last = page.at(-1);

    const [availability, surge] = await Promise.all([
      this.findAvailability(page.map((c) => c.id)),
      this.surge.multipliersFor(page.map((c) => c.zoneId)),
    ]);

    const now = new Date();
    const items = page
      .map((candidate) => ({
        candidate,
        availableSlots: availability.get(candidate.id) ?? NO_AVAILABILITY,
        surgeMultiplier: surge.get(candidate.zoneId) ?? 1,
        isOpenNow: isOpenAt(candidate.schedule, now),
      }))
      // A space with nothing free of the requested vehicle type is not a
      // result. Dropped here rather than in stage 1 so the cacheable candidate
      // set stays independent of a value that must never be cached.
      .filter((item) => this.hasFreeSlot(item.availableSlots, q));

    return {
      items,
      hasMore,
      // The cursor is taken from the last *candidate* of the page, not the last
      // surviving item: a row dropped for having no free slot has still been
      // paged past, and re-scanning it would stall pagination.
      nextCursor: hasMore && last !== undefined ? encodeCursor(this.cursorFor(last, q), q) : null,
    };
  }

  private hasFreeSlot(available: SlotAvailability, q: SearchSpacesQuery): boolean {
    if (q.vehicleType === 'car') return available.car > 0;
    if (q.vehicleType === 'two_wheeler') return available.twoWheeler > 0;
    return true;
  }

  private cursorFor(candidate: Candidate, q: SearchSpacesQuery): SearchCursor {
    switch (q.sortBy) {
      case 'distance':
        return { sortBy: 'distance', value: candidate.distanceExactM, id: candidate.id };
      case 'price':
        return { sortBy: 'price', value: candidate.basePricePaise, id: candidate.id };
      case 'rating':
        return { sortBy: 'rating', value: candidate.ratingAvgBp ?? 0, id: candidate.id };
    }
  }

  /**
   * Page 1 may come from the 60s candidate cache. Page 2 and beyond skip it
   * entirely — keyset correctness matters more than the hit rate on a page most
   * sessions never reach.
   */
  private async candidates(q: SearchSpacesQuery): Promise<Candidate[]> {
    if (q.cursor === undefined) {
      const cached = await this.cache.read(q);
      if (cached !== undefined) return cached;

      const fresh = await this.findCandidates(q, undefined);
      await this.cache.write(q, fresh);
      return fresh;
    }

    const cursor = decodeCursor(q.cursor, q);
    if (cursor === undefined) {
      throw new BadRequestException({
        error: 'invalid cursor',
        message: 'That page link is no longer valid. Start the search again.',
      });
    }

    return this.findCandidates(q, cursor);
  }

  private async findCandidates(
    q: SearchSpacesQuery,
    cursor: SearchCursor | undefined,
  ): Promise<Candidate[]> {
    const origin = originPoint(q.lat, q.lng);
    const basePrice = basePriceExpr(q);
    const conditions = buildConditions(q, origin, basePrice);

    if (cursor !== undefined) conditions.push(cursorCondition(cursor, origin, basePrice));

    // LIMIT limit + 1 answers meta.hasMore without a second COUNT (R-PERF-03).
    const rows = await this.db.execute(sql`
      SELECT
        s.id,
        s.title,
        s.address_line,
        ST_Y(s.location::geometry)                     AS lat,
        ST_X(s.location::geometry)                     AS lng,
        ST_Distance(s.location, ${origin})             AS distance_exact,
        round(ST_Distance(s.location, ${origin}))::int AS distance_m,
        s.rating_avg_bp,
        coalesce(s.rating_avg_bp, 0)                   AS rating_sort,
        s.rating_count,
        s.amenities,
        s.schedule,
        ${basePrice}                                   AS base_price_paise,
        s.zone_id,
        ph.url                                         AS thumbnail_url
      FROM spaces s
      LEFT JOIN space_photos ph
             ON ph.space_id = s.id AND ph.is_primary
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ${orderByExpr(q.sortBy)}
      LIMIT ${q.limit + 1}
    `);

    return [...rows].map((row) => toCandidate(row));
  }

  /**
   * Availability, computed per request and never cached (R-PERF-05). A stale
   * answer is either a double booking or a lost sale.
   *
   * The `booking_slots_no_overlap` GiST index over
   * (space_id, vehicle_type, slot_index, period) serves this NOT EXISTS
   * directly, so it is an index probe rather than a counting subquery.
   */
  async findAvailability(spaceIds: readonly string[]): Promise<Map<string, SlotAvailability>> {
    if (spaceIds.length === 0) return new Map();

    const rows = await this.db.execute(sql`
      SELECT
        ss.space_id,
        count(*) FILTER (WHERE ss.vehicle_type = 'car')         AS car_free,
        count(*) FILTER (WHERE ss.vehicle_type = 'two_wheeler') AS two_wheeler_free
      FROM space_slots ss
      WHERE ss.space_id IN (${sql.join(
        spaceIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND NOT EXISTS (
          SELECT 1
          FROM booking_slots bs
          WHERE bs.space_id     = ss.space_id
            AND bs.vehicle_type = ss.vehicle_type
            AND bs.slot_index   = ss.slot_index
            AND bs.status IN (${sql.join(
              LIVE_SLOT_STATUSES.map((status) => sql`${status}`),
              sql`, `,
            )})
            AND bs.period && tstzrange(now(), now() + ${DISCOVERY_WINDOW}::interval, '[)')
        )
      GROUP BY ss.space_id
    `);

    return new Map(
      [...rows].map((row) => {
        const r = row;
        return [
          String(r['space_id']),
          { car: Number(r['car_free']), twoWheeler: Number(r['two_wheeler_free']) },
        ];
      }),
    );
  }
}
