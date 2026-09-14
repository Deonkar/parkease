import { spaceSearchItemSchema } from '@parkease/contracts/driver';
import { spaceIdSchema } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import type { Candidate } from '../src/domains/space/search-cache.js';
import type { SearchResult } from '../src/domains/space/search.service.js';
import { toSpaceResultView } from '../src/roles/driver/views/space-result.view.js';

const candidate: Candidate = {
  id: spaceIdSchema.parse('0192f1b3-0000-7000-8000-000000000001'),
  title: 'Basement Parking',
  addressLine: '5th Cross, Koramangala',
  lat: 12.9349,
  lng: 77.627,
  distanceM: 450,
  distanceExactM: 450.25,
  ratingAvgBp: 42_000,
  ratingCount: 18,
  amenities: ['covered', 'cctv'],
  schedule: { is24x7: true },
  basePricePaise: 3000,
  zoneId: 'tdr1vk',
  thumbnailUrl: 'https://res.cloudinary.com/parkease/image/upload/v1/a.jpg',
};

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    candidate,
    availableSlots: { car: 1, twoWheeler: 3 },
    surgeMultiplier: 1,
    isOpenNow: true,
    ...overrides,
  };
}

describe('toSpaceResultView', () => {
  it('produces an item that satisfies the published contract', () => {
    expect(() => spaceSearchItemSchema.parse(toSpaceResultView(result()))).not.toThrow();
  });

  it('carries the space through unchanged', () => {
    const item = toSpaceResultView(result());

    expect(item.id).toBe(candidate.id);
    expect(item.title).toBe('Basement Parking');
    expect(item.addressLine).toBe('5th Cross, Koramangala');
    expect(item.location).toEqual({ lat: 12.9349, lng: 77.627 });
    expect(item.distanceM).toBe(450);
    expect(item.amenities).toEqual(['covered', 'cctv']);
    expect(item.availableSlots).toEqual({ car: 1, twoWheeler: 3 });
    expect(item.isOpenNow).toBe(true);
  });

  it('converts basis points to stars', () => {
    expect(toSpaceResultView(result()).rating).toBe(4.2);
    expect(
      toSpaceResultView(result({ candidate: { ...candidate, ratingAvgBp: 50_000 } })).rating,
    ).toBe(5);
  });

  it('reports an unreviewed space as null, never zero', () => {
    // The client renders "New" for null. A 0 would render as a zero-star space.
    const item = toSpaceResultView(
      result({ candidate: { ...candidate, ratingAvgBp: null, ratingCount: 0 } }),
    );

    expect(item.rating).toBeNull();
    expect(item.reviewCount).toBe(0);
  });

  it('reports a missing thumbnail as null', () => {
    expect(
      toSpaceResultView(result({ candidate: { ...candidate, thumbnailUrl: null } })).thumbnail,
    ).toBeNull();
  });

  it('leaves the price alone when there is no surge', () => {
    const item = toSpaceResultView(result());

    expect(item.basePricePaise).toBe(3000);
    expect(item.surgeMultiplier).toBe(1);
    expect(item.effectivePricePaise).toBe(3000);
  });

  it('applies surge to the base price', () => {
    const item = toSpaceResultView(result({ surgeMultiplier: 1.5 }));

    expect(item.basePricePaise).toBe(3000);
    expect(item.surgeMultiplier).toBe(1.5);
    expect(item.effectivePricePaise).toBe(4500);
  });

  it('keeps the effective price an integer number of paise', () => {
    // 333 * 1.5 is 499.5. Money never carries a fraction of a paisa.
    const item = toSpaceResultView(
      result({ candidate: { ...candidate, basePricePaise: 333 }, surgeMultiplier: 1.5 }),
    );

    expect(Number.isInteger(item.effectivePricePaise)).toBe(true);
    expect(item.effectivePricePaise).toBe(500);
  });

  it('never float-multiplies the money', () => {
    // 1.1 * 2999 is 3298.9000000000005 in binary floating point.
    const item = toSpaceResultView(
      result({ candidate: { ...candidate, basePricePaise: 2999 }, surgeMultiplier: 1.1 }),
    );

    expect(item.effectivePricePaise).toBe(3299);
  });

  it('adds no GST and no platform fee — that is Review & Pay, not discovery', () => {
    const item = toSpaceResultView(result({ surgeMultiplier: 2 }));

    // Base plus surge only (ADR-009). 18% GST on top would be 7080.
    expect(item.effectivePricePaise).toBe(6000);
  });
});
