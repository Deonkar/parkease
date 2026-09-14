import { spaceSearchItemSchema, type SpaceSearchItem } from '@parkease/contracts/driver';

/**
 * Builds a search result through the real contract schema, so a fixture that
 * drifts from the contract fails the test rather than hiding the drift.
 */
export function makeItem(overrides: Record<string, unknown> = {}): SpaceSearchItem {
  return spaceSearchItemSchema.parse({
    id: '0192f1b3-0000-7000-8000-000000000001',
    title: 'Basement Parking',
    addressLine: '5th Cross, Koramangala',
    location: { lat: 12.9345, lng: 77.6266 },
    distanceM: 450,
    thumbnail: null,
    rating: 4.2,
    reviewCount: 18,
    amenities: ['covered', 'cctv'],
    availableSlots: { car: 1, twoWheeler: 3 },
    basePricePaise: 3000,
    surgeMultiplier: 1.5,
    effectivePricePaise: 4500,
    isOpenNow: true,
    ...overrides,
  });
}
