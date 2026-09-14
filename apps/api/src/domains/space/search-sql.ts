import { createHash } from 'node:crypto';

import type { SearchSort, SearchSpacesQuery } from '@parkease/contracts/driver';
import type { DurationType, VehicleType } from '@parkease/contracts/enums';
import { ApprovalStatus } from '@parkease/contracts/enums';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

export const WGS84 = 4326;

/** Discovery has no time window yet, so availability is evaluated over the next hour. */
export const DISCOVERY_WINDOW = '1 hour';

/**
 * The statuses that actually consume a slot. This is deliberately the same set
 * as the `booking_slots_no_overlap` exclusion constraint's own WHERE clause —
 * if the two ever disagree, discovery advertises a slot the constraint will
 * refuse at booking time. `held` is not live (it has not been paid for) and
 * `released` has been given back.
 */
export const LIVE_SLOT_STATUSES = ['confirmed', 'active'] as const;

/** `spaces.rating_avg_bp` is basis points: 4.2 stars is stored as 42000. */
export const RATING_BP_PER_STAR = 10_000;

const PRICING_VEHICLE_KEY: Readonly<Record<VehicleType, string>> = {
  car: 'car',
  two_wheeler: 'twoWheeler',
};

const PRICING_DURATION_KEY: Readonly<Record<DurationType, string>> = {
  hourly: 'hourlyPaise',
  daily: 'dailyPaise',
  weekly: 'weeklyPaise',
  monthly: 'monthlyPaise',
};

export function originPoint(lat: number, lng: number): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), ${WGS84})::geography`;
}

/**
 * Price for the requested duration, in paise. When no vehicle type is filtered
 * we take the cheaper of the two — `least()` ignores NULLs, so a space priced
 * for only one vehicle still yields that vehicle's price rather than NULL.
 *
 * The JSONB path keys come from closed enums via a constant lookup and reach
 * Postgres as a bound `text[]`, never as a SQL fragment (R-SEC-02).
 */
export function basePriceExpr(q: SearchSpacesQuery): SQL {
  const durationKey = PRICING_DURATION_KEY[q.durationType];

  if (q.vehicleType !== undefined) {
    const vehicleKey = PRICING_VEHICLE_KEY[q.vehicleType];
    return sql`(s.pricing #>> ARRAY[${vehicleKey}, ${durationKey}])::bigint`;
  }

  return sql`least(
    (s.pricing #>> ARRAY[${'car'}, ${durationKey}])::bigint,
    (s.pricing #>> ARRAY[${'twoWheeler'}, ${durationKey}])::bigint
  )`;
}

export function buildConditions(q: SearchSpacesQuery, origin: SQL, basePrice: SQL): SQL[] {
  const conditions: SQL[] = [
    // Only live listings are discoverable. Deactivated, pending, rejected and
    // soft-deleted spaces all fall out here.
    sql`s.approval_status = ${ApprovalStatus.ACTIVE}`,
    sql`s.deleted_at IS NULL`,
    // Index-backed: spaces_location_gix / spaces_active_location_gix.
    sql`ST_DWithin(s.location, ${origin}, ${q.radiusM})`,
    // A space with no price for the requested duration cannot be booked for it.
    sql`${basePrice} IS NOT NULL`,
  ];

  if (q.vehicleType !== undefined) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM space_slots ss
      WHERE ss.space_id = s.id AND ss.vehicle_type = ${q.vehicleType}
    )`);
  }

  if (q.minPricePaise !== undefined) {
    conditions.push(sql`${basePrice} >= ${q.minPricePaise}`);
  }
  if (q.maxPricePaise !== undefined) {
    conditions.push(sql`${basePrice} <= ${q.maxPricePaise}`);
  }

  if (q.amenities.length > 0) {
    // Containment, not overlap: "covered AND cctv" means both. Backed by
    // spaces_amenities_gin (jsonb_path_ops).
    conditions.push(sql`s.amenities @> ${JSON.stringify(q.amenities)}::jsonb`);
  }

  if (q.minRating !== undefined) {
    // Rounded rather than multiplied straight through: 3.9 * 10000 is
    // 39000.000000000004 in binary floating point, which would exclude a space
    // sitting on exactly 39000 bp. A NULL rating_avg_bp (never reviewed) fails
    // this comparison, which is the intent — "at least 4 stars" excludes unrated.
    conditions.push(sql`s.rating_avg_bp >= ${Math.round(q.minRating * RATING_BP_PER_STAR)}`);
  }

  return conditions;
}

export function orderByExpr(sortBy: SearchSort): SQL {
  switch (sortBy) {
    case 'distance':
      // The exact distance, not the rounded display metre: `cursorCondition`
      // compares raw ST_Distance, and an ORDER BY on the rounded value would
      // disagree with it across a rounding boundary — duplicating or dropping
      // rows between pages.
      return sql`distance_exact ASC, s.id ASC`;
    case 'price':
      return sql`base_price_paise ASC, s.id ASC`;
    case 'rating':
      return sql`rating_sort DESC, s.id DESC`;
  }
}

export interface SearchCursor {
  readonly sortBy: SearchSort;
  readonly value: number;
  readonly id: string;
  /**
   * The origin `value` was measured from, for a distance cursor.
   *
   * It travels in the cursor rather than being taken from the next request,
   * because the two are not always the same point: a candidate-cache hit serves
   * rows whose distances were measured from whichever origin populated the
   * cell, up to ~216m from the current caller. Ordering page 2 by distance from
   * the caller while comparing against a value measured from someone else skips
   * or repeats every row between the two. Carrying the origin makes the cursor
   * self-consistent, and page 2 continues the same ordering page 1 showed.
   */
  readonly origin: { readonly lat: number; readonly lng: number };
}

/**
 * Keyset pagination. Both keys of the tuple sort the same direction, so "the
 * rows after this one" is a single row comparison rather than an OR-chain.
 */
export function cursorCondition(c: SearchCursor, _origin: SQL, basePrice: SQL): SQL {
  switch (c.sortBy) {
    case 'distance':
      // The cursor's own origin, not the request's — see SearchCursor.origin.
      return sql`(ST_Distance(s.location, ${originPoint(c.origin.lat, c.origin.lng)}), s.id) > (${c.value}::float8, ${c.id}::uuid)`;
    case 'price':
      return sql`(${basePrice}, s.id) > (${c.value}::bigint, ${c.id}::uuid)`;
    case 'rating':
      return sql`(coalesce(s.rating_avg_bp, 0), s.id) < (${c.value}::int, ${c.id}::uuid)`;
  }
}

/**
 * Identity of a filter set: every parameter except the cursor *and the origin*,
 * canonicalised so key order and amenity order cannot produce two hashes for
 * one query.
 *
 * The origin is deliberately excluded. This is the cache key's suffix, and the
 * cache key already carries the origin as a geohash cell — including the exact
 * coordinates here would mean two drivers 20m apart never share an entry, which
 * is the whole point of quantising to a cell.
 */
export function filtersHash(q: SearchSpacesQuery): string {
  const canonical = JSON.stringify([
    q.radiusM,
    q.vehicleType ?? null,
    q.durationType,
    q.minPricePaise ?? null,
    q.maxPricePaise ?? null,
    [...q.amenities].sort(),
    q.minRating ?? null,
    q.sortBy,
    q.limit,
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * What a cursor is bound to: the filter set.
 *
 * Replaying a cursor against a *different filter set* silently skips or repeats
 * rows, so that is rejected. The origin is not part of the binding because the
 * cursor carries its own (see `SearchCursor.origin`) and page 2 continues from
 * that — which is the only way a cache hit, whose rows were measured from
 * another point in the cell, can page correctly.
 */
function cursorBinding(q: SearchSpacesQuery): string {
  return createHash('sha256').update(filtersHash(q)).digest('hex').slice(0, 16);
}

const cursorPayloadSchema = z.object({
  s: z.enum(['distance', 'price', 'rating']),
  v: z.number().finite(),
  i: z.string().uuid(),
  h: z.string(),
  // Untrusted input: bounded here so it cannot reach ST_Distance as anything
  // but a real coordinate (R-VAL-01).
  o: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]),
});

export function encodeCursor(c: SearchCursor, q: SearchSpacesQuery): string {
  const payload = {
    s: c.sortBy,
    v: c.value,
    i: c.id,
    h: cursorBinding(q),
    o: [c.origin.lat, c.origin.lng],
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * A cursor is untrusted input: it is base64url JSON from the wire. It is parsed
 * through a schema before any value reaches SQL (R-VAL-01), and carries the
 * filter hash it was issued under so it cannot be replayed against a different
 * filter set — which would silently skip or repeat rows.
 *
 * Returns `undefined` for anything unusable; the caller turns that into a
 * 400 INVALID_CURSOR. Undefined is unambiguous here because the caller only
 * calls this with a cursor the client actually sent.
 */
export function decodeCursor(raw: string, q: SearchSpacesQuery): SearchCursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Malformed base64url or JSON — a typed failure, not a swallowed error.
    return undefined;
  }

  const payload = cursorPayloadSchema.safeParse(parsed);
  if (!payload.success) return undefined;
  if (payload.data.h !== cursorBinding(q)) return undefined;

  const [lat, lng] = payload.data.o;
  return {
    sortBy: payload.data.s,
    value: payload.data.v,
    id: payload.data.i,
    origin: { lat, lng },
  };
}
