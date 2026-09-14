import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  activeFilterCount,
  toSearchParams,
  type SearchFilters,
} from '../hooks/useSearchFilters';

const ORIGIN = { lat: 12.9345, lng: 77.6266 };

describe('DEFAULT_FILTERS', () => {
  it('matches the contract defaults so an unfiltered search sends nothing surprising', () => {
    expect(DEFAULT_FILTERS.durationType).toBe('hourly');
    expect(DEFAULT_FILTERS.sortBy).toBe('distance');
    expect(DEFAULT_FILTERS.amenities).toEqual([]);
    expect(DEFAULT_FILTERS.vehicleType).toBeUndefined();
  });
});

describe('toSearchParams', () => {
  it('always carries the origin, radius, duration and sort', () => {
    expect(toSearchParams(ORIGIN, DEFAULT_FILTERS)).toEqual({
      lat: 12.9345,
      lng: 77.6266,
      radiusM: DEFAULT_FILTERS.radiusM,
      durationType: 'hourly',
      sortBy: 'distance',
    });
  });

  it('omits every unset optional filter rather than sending empty values', () => {
    const params = toSearchParams(ORIGIN, DEFAULT_FILTERS);
    expect(params).not.toHaveProperty('vehicleType');
    expect(params).not.toHaveProperty('minPricePaise');
    expect(params).not.toHaveProperty('maxPricePaise');
    expect(params).not.toHaveProperty('minRating');
    expect(params).not.toHaveProperty('amenities');
  });

  it('joins amenities as CSV, which is what the contract parses', () => {
    const filters: SearchFilters = { ...DEFAULT_FILTERS, amenities: ['covered', 'cctv'] };
    expect(toSearchParams(ORIGIN, filters).amenities).toBe('covered,cctv');
  });

  it('passes price bounds through as integer paise', () => {
    const filters: SearchFilters = {
      ...DEFAULT_FILTERS,
      minPricePaise: 1500,
      maxPricePaise: 6000,
    };
    const params = toSearchParams(ORIGIN, filters);
    expect(params.minPricePaise).toBe(1500);
    expect(params.maxPricePaise).toBe(6000);
  });
});

describe('activeFilterCount', () => {
  it('is zero for the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts each amenity separately', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, amenities: ['covered', 'cctv'] })).toBe(2);
  });

  it('counts a price bound, a vehicle type and a rating floor', () => {
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        vehicleType: 'car',
        maxPricePaise: 5000,
        minRating: 4,
      }),
    ).toBe(3);
  });

  it('does not count a non-default sort as a filter', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, sortBy: 'price' })).toBe(0);
  });
});
