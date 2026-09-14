import { searchSpacesQuerySchema, type SearchSpacesQuery } from '@parkease/contracts/driver';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  basePriceExpr,
  buildConditions,
  cursorCondition,
  decodeCursor,
  encodeCursor,
  filtersHash,
  orderByExpr,
  originPoint,
  RATING_BP_PER_STAR,
  type SearchCursor,
} from '../src/domains/space/search-sql.js';

const dialect = new PgDialect();

function render(fragment: SQL): { text: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { text: query.sql, params: query.params };
}

function renderAll(conditions: readonly SQL[]): { text: string; params: unknown[] } {
  return render(sql.join([...conditions], sql` AND `));
}

/** Every query in these tests goes through the real contract schema. */
function query(overrides: Record<string, unknown> = {}): SearchSpacesQuery {
  return searchSpacesQuerySchema.parse({ lat: 12.9345, lng: 77.6266, ...overrides });
}

function conditionsFor(overrides: Record<string, unknown> = {}): {
  text: string;
  params: unknown[];
} {
  const q = query(overrides);
  const origin = originPoint(q.lat, q.lng);
  return renderAll(buildConditions(q, origin, basePriceExpr(q)));
}

describe('originPoint', () => {
  it('binds lng and lat as parameters in that order, never as SQL text', () => {
    const { text, params } = render(originPoint(12.9345, 77.6266));
    expect(params).toEqual([77.6266, 12.9345, 4326]);
    expect(text).not.toContain('12.9345');
    expect(text).not.toContain('77.6266');
  });
});

describe('basePriceExpr', () => {
  it('reads only the requested vehicle key when vehicleType is filtered', () => {
    const { text, params } = render(basePriceExpr(query({ vehicleType: 'two_wheeler' })));
    expect(params).toEqual(['twoWheeler', 'hourlyPaise']);
    expect(text).not.toContain('least');
  });

  it('maps each durationType to its pricing key', () => {
    expect(
      render(basePriceExpr(query({ vehicleType: 'car', durationType: 'monthly' }))).params,
    ).toEqual(['car', 'monthlyPaise']);
  });

  it('falls back to the cheaper of car and two-wheeler when no vehicleType is given', () => {
    const { text, params } = render(basePriceExpr(query()));
    // least() ignores NULLs, so a space priced for only one vehicle still
    // yields that vehicle's price rather than NULL.
    expect(text).toContain('least');
    expect(params).toEqual(['car', 'hourlyPaise', 'twoWheeler', 'hourlyPaise']);
  });

  it('passes the pricing path as bound text, never interpolated into SQL', () => {
    const { text } = render(basePriceExpr(query({ vehicleType: 'car' })));
    expect(text).not.toContain('car');
    expect(text).not.toContain('hourlyPaise');
  });
});

describe('buildConditions — the always-on predicates', () => {
  it('restricts to active, non-deleted spaces inside the radius with a known price', () => {
    const { text, params } = conditionsFor();
    expect(text).toContain('approval_status');
    expect(text).toContain('deleted_at IS NULL');
    expect(text).toContain('ST_DWithin');
    expect(text).toContain('IS NOT NULL');
    expect(params).toContain('active');
    expect(params).toContain(5000);
  });

  it('adds no optional predicate when no optional filter is set', () => {
    const { text } = conditionsFor();
    expect(text).not.toContain('space_slots');
    expect(text).not.toContain('amenities');
    expect(text).not.toContain('rating_avg_bp');
  });
});

describe('buildConditions — one predicate per filter', () => {
  it('vehicleType adds an EXISTS probe over space_slots', () => {
    const { text, params } = conditionsFor({ vehicleType: 'two_wheeler' });
    expect(text).toContain('space_slots');
    expect(text).toContain('vehicle_type');
    expect(params).toContain('two_wheeler');
  });

  it('minPricePaise adds a lower bound, bound as a parameter', () => {
    const { text, params } = conditionsFor({ minPricePaise: '2000' });
    expect(text).toContain('>=');
    expect(params).toContain(2000);
    expect(text).not.toContain('2000');
  });

  it('maxPricePaise adds an upper bound, bound as a parameter', () => {
    const { params } = conditionsFor({ maxPricePaise: '2000' });
    expect(params).toContain(2000);
  });

  it('amenities uses jsonb containment, not overlap', () => {
    const { text, params } = conditionsFor({ amenities: 'covered,cctv' });
    // @> is containment: "covered AND cctv". ?| would be overlap — wrong.
    expect(text).toContain('@>');
    expect(text).toContain('::jsonb');
    expect(text).not.toContain('?|');
    expect(params).toContain(JSON.stringify(['covered', 'cctv']));
  });

  it('minRating compares against rating_avg_bp in basis points', () => {
    const { text, params } = conditionsFor({ minRating: '4' });
    expect(text).toContain('rating_avg_bp');
    // 4 stars is 40000 basis points. A NULL rating_avg_bp fails this
    // comparison, which is the intent: "at least 4 stars" excludes unrated.
    expect(params).toContain(4 * RATING_BP_PER_STAR);
  });

  it('converts a fractional minRating to exact basis points', () => {
    // 3.9 * 10000 is 39000.000000000004 in binary floating point, which would
    // exclude a space sitting on exactly 39000 bp.
    expect(conditionsFor({ minRating: '3.9' }).params).toContain(39_000);
    expect(conditionsFor({ minRating: '4.5' }).params).toContain(45_000);
  });

  it('combines every filter as an intersection, not a union', () => {
    const { text } = conditionsFor({
      vehicleType: 'two_wheeler',
      minPricePaise: '1000',
      maxPricePaise: '2500',
      amenities: 'covered,cctv',
      minRating: '4',
    });
    expect(text).not.toContain(' OR ');
    expect(text.split(' AND ').length).toBeGreaterThanOrEqual(8);
  });

  it('never interpolates a user value into the SQL text', () => {
    const { text } = conditionsFor({
      radiusM: '1234',
      vehicleType: 'car',
      minPricePaise: '777',
      maxPricePaise: '8888',
      amenities: 'covered',
      minRating: '4',
    });
    for (const injected of ['1234', '777', '8888', 'covered', '40000']) {
      expect(text).not.toContain(injected);
    }
  });
});

describe('orderByExpr', () => {
  it('sorts distance ascending with an ascending id tiebreaker', () => {
    // Ordered by the exact distance, not the rounded display metre: the cursor
    // compares raw ST_Distance, and if the two disagree, rows on either side of
    // a rounding boundary are duplicated across pages or skipped entirely.
    expect(render(orderByExpr('distance')).text).toBe('distance_exact ASC, s.id ASC');
  });

  it('sorts price ascending with an ascending id tiebreaker', () => {
    expect(render(orderByExpr('price')).text).toBe('base_price_paise ASC, s.id ASC');
  });

  it('sorts rating descending with a descending id tiebreaker', () => {
    // Both keys must sort the same direction for the cursor's row comparison
    // to be expressible as a single tuple comparison.
    expect(render(orderByExpr('rating')).text).toBe('rating_sort DESC, s.id DESC');
  });
});

describe('cursorCondition', () => {
  const id = '0192f1b3-0000-7000-8000-000000000001';

  it('uses a greater-than tuple comparison for an ascending sort', () => {
    const q = query();
    const c: SearchCursor = { sortBy: 'distance', value: 450, id };
    const { text, params } = render(
      cursorCondition(c, originPoint(q.lat, q.lng), basePriceExpr(q)),
    );
    expect(text).toContain('>');
    expect(text).not.toContain('<');
    expect(params).toContain(450);
    expect(params).toContain(id);
  });

  it('uses a less-than tuple comparison for the descending rating sort', () => {
    const q = query({ sortBy: 'rating' });
    const c: SearchCursor = { sortBy: 'rating', value: 42_000, id };
    const { text, params } = render(
      cursorCondition(c, originPoint(q.lat, q.lng), basePriceExpr(q)),
    );
    expect(text).toContain('<');
    expect(params).toContain(42_000);
  });

  it('compares price against the same base-price expression the page was sorted by', () => {
    const q = query({ sortBy: 'price', vehicleType: 'car' });
    const { text } = render(
      cursorCondition(
        { sortBy: 'price', value: 3000, id },
        originPoint(q.lat, q.lng),
        basePriceExpr(q),
      ),
    );
    expect(text).toContain('pricing');
  });
});

describe('filtersHash', () => {
  it('is stable across key order', () => {
    const a = searchSpacesQuerySchema.parse({
      lat: 12.9345,
      lng: 77.6266,
      sortBy: 'price',
      minRating: 4,
    });
    const b = searchSpacesQuerySchema.parse({
      minRating: 4,
      sortBy: 'price',
      lng: 77.6266,
      lat: 12.9345,
    });
    expect(filtersHash(a)).toBe(filtersHash(b));
  });

  it('is stable across amenity order', () => {
    expect(filtersHash(query({ amenities: 'cctv,covered' }))).toBe(
      filtersHash(query({ amenities: 'covered,cctv' })),
    );
  });

  it('ignores the cursor, so page 2 of one filter set shares its hash', () => {
    expect(filtersHash(query({ cursor: 'abc' }))).toBe(filtersHash(query()));
  });

  it('ignores the exact origin, which the cache key carries as a geohash cell', () => {
    // If the exact coordinates were in this hash, two drivers 20m apart would
    // never share a cache entry and the cell in the key would buy nothing.
    expect(filtersHash(query({ lat: 12.93452, lng: 77.62662 }))).toBe(filtersHash(query()));
  });

  it('changes when any filter changes', () => {
    const base = filtersHash(query());
    expect(filtersHash(query({ minRating: '4' }))).not.toBe(base);
    expect(filtersHash(query({ radiusM: '2000' }))).not.toBe(base);
    expect(filtersHash(query({ sortBy: 'price' }))).not.toBe(base);
    expect(filtersHash(query({ vehicleType: 'car' }))).not.toBe(base);
    expect(filtersHash(query({ durationType: 'daily' }))).not.toBe(base);
    expect(filtersHash(query({ minPricePaise: '100' }))).not.toBe(base);
    expect(filtersHash(query({ maxPricePaise: '100' }))).not.toBe(base);
    expect(filtersHash(query({ amenities: 'covered' }))).not.toBe(base);
    expect(filtersHash(query({ limit: '5' }))).not.toBe(base);
  });
});

describe('cursor codec', () => {
  const id = '0192f1b3-0000-7000-8000-000000000001';
  const cursor: SearchCursor = { sortBy: 'distance', value: 450.25, id };

  it('round-trips through base64url', () => {
    const q = query();
    expect(decodeCursor(encodeCursor(cursor, q), q)).toEqual(cursor);
  });

  it('produces a url-safe token within the contract length cap', () => {
    const token = encodeCursor(cursor, query());
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThanOrEqual(256);
  });

  it('rejects a cursor replayed against a different filter set', () => {
    const token = encodeCursor(cursor, query());
    expect(decodeCursor(token, query({ minRating: '4' }))).toBeUndefined();
  });

  it('rejects a cursor replayed against a different sort', () => {
    const token = encodeCursor(cursor, query());
    expect(decodeCursor(token, query({ sortBy: 'price' }))).toBeUndefined();
  });

  it('rejects a cursor replayed against a different origin', () => {
    // A distance cursor carries a distance measured from the origin that issued
    // it. Replayed from somewhere else it silently skips or repeats rows, so
    // the cursor binds the exact origin even though the cache key does not.
    const token = encodeCursor(cursor, query());
    expect(decodeCursor(token, query({ lat: 12.97, lng: 77.59 }))).toBeUndefined();
    expect(decodeCursor(token, query({ lat: 12.93452, lng: 77.62662 }))).toBeUndefined();
  });

  it('rejects garbage rather than throwing', () => {
    const q = query();
    expect(decodeCursor('not-base64!!', q)).toBeUndefined();
    expect(decodeCursor('', q)).toBeUndefined();
    expect(
      decodeCursor(Buffer.from('{"not":"a cursor"}').toString('base64url'), q),
    ).toBeUndefined();
    expect(decodeCursor(Buffer.from('[]').toString('base64url'), q)).toBeUndefined();
  });

  it('rejects a tampered id that is not a uuid', () => {
    const q = query();
    const forged = Buffer.from(
      JSON.stringify({ s: 'distance', v: 1, i: "'; DROP TABLE spaces; --", h: filtersHash(q) }),
    ).toString('base64url');
    expect(decodeCursor(forged, q)).toBeUndefined();
  });

  it('rejects a non-finite sort value', () => {
    const q = query();
    const forged = Buffer.from(
      JSON.stringify({ s: 'distance', v: 'NaN', i: id, h: filtersHash(q) }),
    ).toString('base64url');
    expect(decodeCursor(forged, q)).toBeUndefined();
  });
});
