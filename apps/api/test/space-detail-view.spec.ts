import { NO_SURGE_SNAPSHOT, type SurgeSnapshot } from '@parkease/contracts/admin';
import { spaceDetailSchema } from '@parkease/contracts/driver';
import { toPaise } from '@parkease/contracts/primitives';
import { describe, expect, it } from 'vitest';

import {
  toSpaceDetailView,
  type SpaceDetailInput,
} from '../src/roles/driver/views/space-detail.view.js';

function surging(multiplierBp: number, badge: SurgeSnapshot['badge']): SurgeSnapshot {
  return {
    multiplierBp,
    badge,
    occupancyBp: 8_000,
    appliedModifiers: [],
    calculatedAt: '2026-09-06T10:00:00.000Z',
  };
}

function input(overrides: Partial<SpaceDetailInput> = {}): SpaceDetailInput {
  return {
    space: {
      id: '0192f1b3-0000-7000-8000-000000000001',
      title: 'Basement Parking, 5th Cross',
      description: null,
      addressLine: '5th Cross, Koramangala',
      landmark: null,
      city: 'Bengaluru',
      location: { lat: 12.9349, lng: 77.627 },
      amenities: ['covered'],
      schedule: { is24x7: true },
      pricing: { car: { hourlyPaise: toPaise(3000) } },
      ratingAvgBp: 42_000,
      ratingCount: 18,
    },
    ownerName: 'Ramesh Kumar',
    ownerSince: new Date('2025-01-01T00:00:00.000Z'),
    isOpenNow: true,
    availableNow: { car: 2, twoWheeler: 0 },
    totalSlots: { car: 4, twoWheeler: 0 },
    surge: NO_SURGE_SNAPSHOT,
    photos: [{ url: 'https://res.cloudinary.com/parkease/image/upload/v1/a.jpg', isPrimary: true }],
    defaultBooking: null,
    ...overrides,
  };
}

describe('toSpaceDetailView', () => {
  it('produces a detail that satisfies the published contract', () => {
    expect(() => spaceDetailSchema.parse(toSpaceDetailView(input()))).not.toThrow();
  });

  it('reports no surge as 1.0x with no badge', () => {
    const detail = toSpaceDetailView(input());

    expect(detail.surgeMultiplier).toBe(1);
    expect(detail.surgeBadge).toBeNull();
  });

  it('carries the tier that drives the space-detail banner', () => {
    const detail = toSpaceDetailView(input({ surge: surging(15_000, 'high_demand') }));

    expect(detail.surgeMultiplier).toBe(1.5);
    expect(detail.surgeBadge).toBe('high_demand');
  });

  it('names the tier the server chose for every rung of the ladder', () => {
    const rungs = [
      [12_500, 'moderate_demand', 1.25],
      [15_000, 'high_demand', 1.5],
      [20_000, 'very_high_demand', 2],
    ] as const;

    for (const [multiplierBp, badge, expected] of rungs) {
      const detail = toSpaceDetailView(input({ surge: surging(multiplierBp, badge) }));
      expect(detail.surgeMultiplier).toBe(expected);
      expect(detail.surgeBadge).toBe(badge);
    }
  });

  it('quotes no price of its own — base rates only (ADR-009, R-FE-06)', () => {
    // The banner says prices may be higher; the breakdown belongs to Review &
    // Pay. Nothing on this screen multiplies the rate card by the multiplier.
    const detail = toSpaceDetailView(input({ surge: surging(20_000, 'very_high_demand') }));

    expect(detail.pricing.car?.hourlyPaise).toBe(3000);
  });

  it('shows the owner by first name only', () => {
    expect(toSpaceDetailView(input()).owner.name).toBe('Ramesh');
  });
});
