import { DEFAULT_SEARCH_RADIUS_M, type SearchSort } from '@parkease/contracts/driver';
import type { Amenity, DurationType, VehicleType } from '@parkease/contracts/enums';
import { useCallback, useMemo, useState } from 'react';

/**
 * The filter set the driver controls. This is client state, not server state —
 * search *results* are never copied into useState (R-FE-02), but the query that
 * produces them is exactly what this hook owns.
 */
export interface SearchFilters {
  readonly vehicleType?: VehicleType;
  readonly durationType: DurationType;
  readonly minPricePaise?: number;
  readonly maxPricePaise?: number;
  readonly amenities: readonly Amenity[];
  readonly minRating?: number;
  readonly sortBy: SearchSort;
  readonly radiusM: number;
}

export const DEFAULT_FILTERS: SearchFilters = {
  durationType: 'hourly',
  amenities: [],
  sortBy: 'distance',
  radiusM: DEFAULT_SEARCH_RADIUS_M,
};

export interface SearchOrigin {
  readonly lat: number;
  readonly lng: number;
}

export type SearchParams = Record<string, string | number>;

/**
 * Serialises filters for the endpoint. Unset filters are omitted rather than
 * sent empty, so the server applies its own documented defaults.
 */
export function toSearchParams(origin: SearchOrigin, filters: SearchFilters): SearchParams {
  const params: SearchParams = {
    lat: origin.lat,
    lng: origin.lng,
    radiusM: filters.radiusM,
    durationType: filters.durationType,
    sortBy: filters.sortBy,
  };

  if (filters.vehicleType !== undefined) params.vehicleType = filters.vehicleType;
  if (filters.minPricePaise !== undefined) params.minPricePaise = filters.minPricePaise;
  if (filters.maxPricePaise !== undefined) params.maxPricePaise = filters.maxPricePaise;
  if (filters.minRating !== undefined) params.minRating = filters.minRating;
  if (filters.amenities.length > 0) params.amenities = filters.amenities.join(',');

  return params;
}

/** Drives the badge on the Filters button. Sort order is a view choice, not a filter. */
export function activeFilterCount(filters: SearchFilters): number {
  let count = filters.amenities.length;
  if (filters.vehicleType !== undefined) count += 1;
  if (filters.minPricePaise !== undefined) count += 1;
  if (filters.maxPricePaise !== undefined) count += 1;
  if (filters.minRating !== undefined) count += 1;
  if (filters.durationType !== DEFAULT_FILTERS.durationType) count += 1;
  return count;
}

export interface UseSearchFilters {
  readonly filters: SearchFilters;
  readonly activeCount: number;
  readonly patch: (next: Partial<SearchFilters>) => void;
  readonly replace: (next: SearchFilters) => void;
  readonly reset: () => void;
}

export function useSearchFilters(): UseSearchFilters {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);

  const patch = useCallback((next: Partial<SearchFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
  }, []);

  const replace = useCallback((next: SearchFilters) => {
    setFilters(next);
  }, []);

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const activeCount = useMemo(() => activeFilterCount(filters), [filters]);

  return { filters, activeCount, patch, replace, reset };
}
