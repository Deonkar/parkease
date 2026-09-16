import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_RADIUS_M,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_RADIUS_M,
  searchSpacesQuerySchema,
  spaceSearchItemSchema,
} from '../src/driver/search-spaces.js';

/** The minimum a caller must supply; everything else has a default. */
const origin = { lat: '12.9345', lng: '77.6266' };

describe('searchSpacesQuerySchema', () => {
  it('coerces lat/lng from query strings', () => {
    const q = searchSpacesQuerySchema.parse(origin);
    expect(q.lat).toBe(12.9345);
    expect(q.lng).toBe(77.6266);
  });

  it('applies every documented default', () => {
    const q = searchSpacesQuerySchema.parse(origin);
    expect(q.radiusM).toBe(DEFAULT_SEARCH_RADIUS_M);
    expect(q.durationType).toBe('hourly');
    expect(q.sortBy).toBe('distance');
    expect(q.limit).toBe(DEFAULT_SEARCH_LIMIT);
    expect(q.amenities).toEqual([]);
  });

  it('leaves optional filters undefined rather than defaulting them', () => {
    const q = searchSpacesQuerySchema.parse(origin);
    expect(q.vehicleType).toBeUndefined();
    expect(q.minPricePaise).toBeUndefined();
    expect(q.maxPricePaise).toBeUndefined();
    expect(q.minRating).toBeUndefined();
    expect(q.cursor).toBeUndefined();
  });

  it.each([
    ['lat', { ...origin, lat: '91' }],
    ['lng', { ...origin, lng: '181' }],
  ])('rejects an out-of-range %s', (_label, input) => {
    expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
  });

  describe('radiusM', () => {
    it('accepts the maximum', () => {
      const q = searchSpacesQuerySchema.parse({ ...origin, radiusM: String(MAX_SEARCH_RADIUS_M) });
      expect(q.radiusM).toBe(MAX_SEARCH_RADIUS_M);
    });

    it('rejects one metre beyond the maximum', () => {
      const input = { ...origin, radiusM: String(MAX_SEARCH_RADIUS_M + 1) };
      expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
    });

    it('rejects a non-positive radius', () => {
      expect(searchSpacesQuerySchema.safeParse({ ...origin, radiusM: '0' }).success).toBe(false);
    });
  });

  describe('limit', () => {
    it('defaults to 20 when absent', () => {
      expect(searchSpacesQuerySchema.parse(origin).limit).toBe(20);
    });

    it('accepts the maximum', () => {
      const q = searchSpacesQuerySchema.parse({ ...origin, limit: String(MAX_SEARCH_LIMIT) });
      expect(q.limit).toBe(MAX_SEARCH_LIMIT);
    });

    it('rejects limit=200', () => {
      expect(searchSpacesQuerySchema.safeParse({ ...origin, limit: '200' }).success).toBe(false);
    });
  });

  describe('amenities', () => {
    it('splits a CSV and trims whitespace', () => {
      const q = searchSpacesQuerySchema.parse({ ...origin, amenities: 'covered, cctv' });
      expect(q.amenities).toEqual(['covered', 'cctv']);
    });

    it('drops empty segments from a trailing comma', () => {
      const q = searchSpacesQuerySchema.parse({ ...origin, amenities: 'covered,' });
      expect(q.amenities).toEqual(['covered']);
    });

    it('rejects a value outside the amenity enum', () => {
      const input = { ...origin, amenities: 'covered,helipad' };
      expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
    });

    it('rejects more than six amenities', () => {
      // Seven entries, every one a valid amenity, so this fails on .max(6) and
      // not incidentally on the enum.
      const input = {
        ...origin,
        amenities: 'covered,cctv,guarded,ev_charging,lit,wheelchair_accessible,covered',
      };
      expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
    });
  });

  describe('price bounds', () => {
    it('accepts min below max', () => {
      const q = searchSpacesQuerySchema.parse({
        ...origin,
        minPricePaise: 1000,
        maxPricePaise: 2500,
      });
      expect(q.minPricePaise).toBe(1000);
      expect(q.maxPricePaise).toBe(2500);
    });

    it('accepts min equal to max', () => {
      const input = { ...origin, minPricePaise: 2000, maxPricePaise: 2000 };
      expect(searchSpacesQuerySchema.safeParse(input).success).toBe(true);
    });

    it('rejects min above max, reporting on maxPricePaise', () => {
      const result = searchSpacesQuerySchema.safeParse({
        ...origin,
        minPricePaise: 5000,
        maxPricePaise: 2000,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.path).toEqual(['maxPricePaise']);
    });

    it('rejects a fractional paise amount', () => {
      const input = { ...origin, minPricePaise: 10.5 };
      expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
    });
  });

  describe('minRating', () => {
    it.each([1, 4, 5])('accepts %s', (value) => {
      expect(searchSpacesQuerySchema.parse({ ...origin, minRating: String(value) }).minRating).toBe(
        value,
      );
    });

    it.each(['0.5', '5.1'])('rejects %s', (value) => {
      expect(searchSpacesQuerySchema.safeParse({ ...origin, minRating: value }).success).toBe(
        false,
      );
    });
  });

  describe('sortBy', () => {
    it.each(['distance', 'price', 'rating'] as const)('accepts %s', (value) => {
      expect(searchSpacesQuerySchema.parse({ ...origin, sortBy: value }).sortBy).toBe(value);
    });

    it('rejects an unknown sort key', () => {
      expect(searchSpacesQuerySchema.safeParse({ ...origin, sortBy: 'cheapest' }).success).toBe(
        false,
      );
    });
  });

  it('rejects a cursor longer than 256 characters', () => {
    const input = { ...origin, cursor: 'x'.repeat(257) };
    expect(searchSpacesQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('spaceSearchItemSchema', () => {
  const item = {
    id: '0192f1b3-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    title: 'Basement Parking',
    addressLine: '5th Cross, Koramangala',
    location: { lat: 12.9345, lng: 77.6266 },
    distanceM: 450,
    thumbnail: 'https://cdn.example.com/a.jpg',
    rating: 4.2,
    reviewCount: 18,
    amenities: ['covered', 'cctv'],
    availableSlots: { car: 1, twoWheeler: 3 },
    basePricePaise: 3000,
    surgeMultiplier: 1,
    surgeBadge: null,
    effectivePricePaise: 3000,
    isOpenNow: true,
  };

  it('accepts a fully populated item', () => {
    expect(spaceSearchItemSchema.parse(item)).toMatchObject({ id: item.id, distanceM: 450 });
  });

  it('accepts a never-reviewed space as rating null, not zero', () => {
    const parsed = spaceSearchItemSchema.parse({ ...item, rating: null, reviewCount: 0 });
    expect(parsed.rating).toBeNull();
  });

  it('accepts a null thumbnail', () => {
    expect(spaceSearchItemSchema.parse({ ...item, thumbnail: null }).thumbnail).toBeNull();
  });

  it('requires availableSlots per vehicle type, not a scalar', () => {
    expect(spaceSearchItemSchema.safeParse({ ...item, availableSlots: 4 }).success).toBe(false);
  });

  it('rejects a fractional distance', () => {
    expect(spaceSearchItemSchema.safeParse({ ...item, distanceM: 450.5 }).success).toBe(false);
  });

  it('rejects a surge multiplier below 1', () => {
    expect(spaceSearchItemSchema.safeParse({ ...item, surgeMultiplier: 0.9 }).success).toBe(false);
  });

  it('rejects a surge multiplier above the documented ceiling', () => {
    expect(spaceSearchItemSchema.safeParse({ ...item, surgeMultiplier: 3.1 }).success).toBe(false);
  });

  it('accepts each of the three surge tiers', () => {
    for (const badge of ['moderate_demand', 'high_demand', 'very_high_demand'] as const) {
      expect(spaceSearchItemSchema.safeParse({ ...item, surgeBadge: badge }).success).toBe(true);
    }
  });

  it('rejects a surge tier the product has no badge for', () => {
    // The client renders the badge from this field rather than deriving a tier
    // from the multiplier, so an unknown tier would be a price with no words.
    expect(spaceSearchItemSchema.safeParse({ ...item, surgeBadge: 'extreme' }).success).toBe(false);
    expect(spaceSearchItemSchema.safeParse({ ...item, surgeBadge: '' }).success).toBe(false);
  });

  it('rejects a missing surge tier, so null is stated rather than implied', () => {
    const withoutBadge: Record<string, unknown> = { ...item };
    delete withoutBadge['surgeBadge'];
    expect(spaceSearchItemSchema.safeParse(withoutBadge).success).toBe(false);
  });

  it('rejects a rating outside 1..5', () => {
    expect(spaceSearchItemSchema.safeParse({ ...item, rating: 5.5 }).success).toBe(false);
  });
});
