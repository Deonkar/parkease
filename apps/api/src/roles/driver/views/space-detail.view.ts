import type { DefaultBooking, DriverRateCard, SpaceDetail } from '@parkease/contracts/driver';
import type { Amenity } from '@parkease/contracts/enums';
import type { DurationPricing, SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';

import { RATING_BP_PER_STAR } from '../../../domains/space/search-sql.js';

interface SpaceRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly addressLine: string;
  readonly landmark: string | null;
  readonly city: string;
  readonly location: { lat: number; lng: number };
  readonly amenities: Amenity[];
  readonly schedule: SpaceSchedule;
  readonly pricing: SpacePricing;
  readonly ratingAvgBp: number | null;
  readonly ratingCount: number;
}

export interface SpaceDetailInput {
  readonly space: SpaceRow;
  readonly ownerName: string | null;
  readonly ownerSince: Date;
  readonly isOpenNow: boolean;
  readonly availableNow: { car: number; twoWheeler: number };
  readonly totalSlots: { car: number; twoWheeler: number };
  readonly surgeMultiplier: number;
  readonly photos: readonly { url: string; isPrimary: boolean }[];
  readonly defaultBooking: DefaultBooking | null;
}

/**
 * Optional rates become explicit nulls rather than absent keys. A client
 * rendering a pricing table needs to know "this space has no weekly rate" as a
 * fact, not infer it from a missing property.
 */
const toRateCard = (card: DurationPricing | undefined): DriverRateCard | null =>
  card === undefined
    ? null
    : ({
        hourlyPaise: card.hourlyPaise,
        dailyPaise: card.dailyPaise ?? null,
        weeklyPaise: card.weeklyPaise ?? null,
        monthlyPaise: card.monthlyPaise ?? null,
      } as DriverRateCard);

/**
 * Base rates only. No fee line and no GST line anywhere on this screen — the
 * full breakdown appears exactly once, at Review & Pay, from a server-issued
 * quote (ADR-009, R-FE-06).
 */
export function toSpaceDetailView(input: SpaceDetailInput): SpaceDetail {
  const { space } = input;

  return {
    id: space.id,
    title: space.title,
    description: space.description,
    addressLine: space.addressLine,
    landmark: space.landmark,
    city: space.city,
    latitude: space.location.lat,
    longitude: space.location.lng,
    photos: input.photos.map((photo) => ({ url: photo.url, isPrimary: photo.isPrimary })),
    amenities: space.amenities,
    schedule: space.schedule,
    isOpenNow: input.isOpenNow,
    pricing: {
      car: toRateCard(space.pricing.car),
      twoWheeler: toRateCard(space.pricing.twoWheeler),
    },
    availableNow: input.availableNow,
    totalSlots: input.totalSlots,
    surgeMultiplier: input.surgeMultiplier,
    // null means never reviewed. The client renders "New", never a zero score.
    rating: space.ratingAvgBp === null ? null : space.ratingAvgBp / RATING_BP_PER_STAR,
    reviewCount: space.ratingCount,
    defaultBooking: input.defaultBooking,
    owner: {
      // First name only. The owner's full name is not the driver's business
      // until a booking exists, and even then only on the scan screen.
      name: (input.ownerName ?? 'Host').split(' ')[0] ?? 'Host',
      memberSince: input.ownerSince.toISOString(),
    },
  } as SpaceDetail;
}
