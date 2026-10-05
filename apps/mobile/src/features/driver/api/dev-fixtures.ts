import {
  type SpaceDetail,
  spaceDetailSchema,
  spaceSearchItemSchema,
  type SpaceSearchItem,
} from '@parkease/contracts/driver';
import type { Amenity, SurgeBadge } from '@parkease/contracts/enums';

import { devReviews } from '../../shared/reviews/dev-fixtures';

import type { SearchQueryParams, SpaceSearchPage } from './spaces';

/**
 * Fixture results for the dev mock session, so discovery is walkable before
 * `GET /api/v1/driver/spaces` exists. Engaged only from a dev mock session —
 * see `isDevMockSession()`. Dev only; never reachable in a release build.
 *
 * Spaces are laid out around whatever origin was searched, so the map is
 * populated wherever the driver (or the browser's geolocation) happens to be.
 */

const TITLES = [
  'Basement Parking',
  'Terrace Slot',
  'Society Visitor Slot',
  'Gated Tower Parking',
  'Corner Shop Frontage',
  'Apartment Stilt Parking',
  'Office Block Bay',
  'Church Street Lot',
  'Metro Station Parking',
  'Mall Level 2 Bay',
];

const STREETS = [
  '5th Cross, Koramangala',
  'Indiranagar 1st Stage',
  'Ejipura Main Road',
  '80 Feet Road, HSR Layout',
  'Bannerghatta Road',
  'Jayanagar 4th Block',
  'Whitefield Main Road',
  'MG Road',
  'Richmond Town',
  'BTM Layout 2nd Stage',
];

const AMENITY_SETS: readonly (readonly Amenity[])[] = [
  ['covered', 'cctv'],
  ['covered'],
  [],
  ['cctv', 'guarded'],
  ['covered', 'cctv', 'ev_charging'],
  ['lit'],
  ['covered', 'wheelchair_accessible'],
  ['guarded', 'lit'],
];

const FIXTURE_COUNT = 64;

/**
 * The default ladder from task-10 §10.3, weighted so most spaces are not
 * surging. Dev only — the live ladder is `surge_config.tiers` in the database
 * and the client never derives a tier from a multiplier.
 */
const SURGE_FIXTURE_TIERS: readonly {
  readonly surgeMultiplier: number;
  readonly surgeBadge: SurgeBadge | null;
}[] = [
  { surgeMultiplier: 1, surgeBadge: null },
  { surgeMultiplier: 1, surgeBadge: null },
  { surgeMultiplier: 1.25, surgeBadge: 'moderate_demand' },
  { surgeMultiplier: 1, surgeBadge: null },
  { surgeMultiplier: 1.5, surgeBadge: 'high_demand' },
  { surgeMultiplier: 1, surgeBadge: null },
  { surgeMultiplier: 2, surgeBadge: 'very_high_demand' },
  { surgeMultiplier: 1, surgeBadge: null },
];

/** Deterministic pseudo-random in [0,1) so the fixture set is stable across reloads. */
function noise(seed: number): number {
  return (Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

function positive(seed: number): number {
  return Math.abs(noise(seed));
}

function buildFixture(index: number, originLat: number, originLng: number): SpaceSearchItem {
  const angle = positive(index + 1) * Math.PI * 2;
  // Denser near the origin, out to roughly 4km.
  const distanceM = Math.round(120 + positive(index + 31) ** 1.6 * 3900);
  const metresPerDegree = 111_320;
  const lat = originLat + (Math.cos(angle) * distanceM) / metresPerDegree;
  const lng =
    originLng +
    (Math.sin(angle) * distanceM) / (metresPerDegree * Math.cos((originLat * Math.PI) / 180));

  const reviewCount = Math.round(positive(index + 71) * 40);
  const rating = reviewCount === 0 ? null : Math.round((3 + positive(index + 97) * 2) * 10) / 10;

  const basePricePaise = (1 + Math.round(positive(index + 13) * 7)) * 1000;
  // Stands in for the server's tier snapshot, so every badge tier is walkable
  // in a dev session. The real ladder is DB-backed and lives in the API.
  const { surgeMultiplier, surgeBadge } = SURGE_FIXTURE_TIERS[
    index % SURGE_FIXTURE_TIERS.length
  ] ?? {
    surgeMultiplier: 1,
    surgeBadge: null,
  };

  const car = Math.round(positive(index + 17) * 3);
  const twoWheeler = Math.round(positive(index + 23) * 4);

  // Parsed, not asserted — a fixture that drifts from the contract fails loudly.
  return spaceSearchItemSchema.parse({
    id: `0192f1b3-0000-7000-8000-${String(index).padStart(12, '0')}`,
    title: TITLES[index % TITLES.length] ?? 'Parking Space',
    addressLine: STREETS[index % STREETS.length] ?? 'Bangalore',
    location: { lat, lng },
    distanceM,
    thumbnail: null,
    reviewCount,
    // The server derives this (task 17); the fixture only mirrors its shape. One fixture in nine
    // is below 3.0 with enough reviews, so "Mixed reviews" is walkable in a dev session.
    badge:
      rating === null
        ? { kind: 'new', label: 'New' }
        : index % 9 === 4 && reviewCount >= 3
          ? { kind: 'low_rated', label: 'Mixed reviews', stars: '2.7', reviewCount }
          : { kind: 'rated', stars: rating.toFixed(1), reviewCount },
    amenities: AMENITY_SETS[index % AMENITY_SETS.length] ?? [],
    // A space with nothing free is still listed; the row shows "0 free".
    availableSlots: { car, twoWheeler },
    basePricePaise,
    surgeMultiplier,
    surgeBadge,
    effectivePricePaise: Math.round(basePricePaise * surgeMultiplier),
    isOpenNow: positive(index + 41) > 0.15,
  });
}

function readNumber(params: SearchQueryParams, key: string): number | undefined {
  const raw = params[key];
  if (raw === undefined) return undefined;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readString(params: SearchQueryParams, key: string): string | undefined {
  const raw = params[key];
  return raw === undefined ? undefined : String(raw);
}

function matchesFilters(item: SpaceSearchItem, params: SearchQueryParams): boolean {
  const vehicleType = readString(params, 'vehicleType');
  if (vehicleType === 'car' && item.availableSlots.car === 0) return false;
  if (vehicleType === 'two_wheeler' && item.availableSlots.twoWheeler === 0) return false;

  const minPrice = readNumber(params, 'minPricePaise');
  if (minPrice !== undefined && item.basePricePaise < minPrice) return false;

  const maxPrice = readNumber(params, 'maxPricePaise');
  if (maxPrice !== undefined && item.basePricePaise > maxPrice) return false;

  const minRating = readNumber(params, 'minRating');
  const stars = starsOf(item);
  if (minRating !== undefined && (stars === null || stars < minRating)) return false;

  const amenities = readString(params, 'amenities');
  if (amenities !== undefined && amenities.length > 0) {
    const required = amenities.split(',').filter(Boolean);
    const has = (name: string) => item.amenities.some((amenity) => amenity === name);
    if (!required.every(has)) return false;
  }

  const radiusM = readNumber(params, 'radiusM');
  if (radiusM !== undefined && item.distanceM > radiusM) return false;

  return true;
}

/** The fixture server filters on the stars it sent, as the real one filters on the stored average. */
const starsOf = (item: SpaceSearchItem): number | null =>
  item.badge.kind === 'new' ? null : Number(item.badge.stars);

function compare(sortBy: string | undefined, a: SpaceSearchItem, b: SpaceSearchItem): number {
  if (sortBy === 'price') return a.effectivePricePaise - b.effectivePricePaise;
  if (sortBy === 'rating') return (starsOf(b) ?? 0) - (starsOf(a) ?? 0);
  return a.distanceM - b.distanceM;
}

/** Mirrors the real endpoint's shape: filtered, sorted, cursor-paginated. */
export function devSearchSpaces(params: SearchQueryParams): SpaceSearchPage {
  const originLat = readNumber(params, 'lat') ?? 12.9345;
  const originLng = readNumber(params, 'lng') ?? 77.6266;
  const limit = readNumber(params, 'limit') ?? 20;
  const offset = Number(readString(params, 'cursor') ?? '0');
  const sortBy = readString(params, 'sortBy');

  const matching = Array.from({ length: FIXTURE_COUNT }, (_, index) =>
    buildFixture(index, originLat, originLng),
  )
    .filter((item) => matchesFilters(item, params))
    .sort((a, b) => compare(sortBy, a, b));

  const start = Number.isFinite(offset) ? offset : 0;
  const page = matching.slice(start, start + limit);
  const nextOffset = start + page.length;
  const hasMore = nextOffset < matching.length;

  return {
    data: page,
    meta: hasMore ? { limit, hasMore, nextCursor: String(nextOffset) } : { limit, hasMore },
  };
}

/**
 * A space's detail in a dev-mock session, built from the same fixture as its search card so the
 * two agree, with the shared review fixtures for its reviews section (task 17b).
 */
export function devSpaceDetail(spaceId: string): SpaceDetail {
  const index = Number.parseInt(spaceId.slice(-12), 10);
  const item = buildFixture(Number.isFinite(index) ? index : 0, 12.9345, 77.6266);
  const reviews = devReviews.spaceDetailReviews();
  const rated = item.badge.kind !== 'new';
  const card = (hourly: number) => ({
    hourlyPaise: hourly,
    dailyPaise: hourly * 8,
    weeklyPaise: null,
    monthlyPaise: null,
  });
  return spaceDetailSchema.parse({
    id: item.id,
    title: item.title,
    description: 'Covered basement bay. Take the ramp on the left after the security cabin.',
    addressLine: item.addressLine,
    landmark: 'Opposite the bakery',
    city: 'Bengaluru',
    latitude: item.location.lat,
    longitude: item.location.lng,
    photos: [],
    amenities: item.amenities,
    schedule: { is24x7: true },
    isOpenNow: item.isOpenNow,
    pricing: { car: card(item.basePricePaise), twoWheeler: null },
    availableNow: item.availableSlots,
    totalSlots: {
      car: Math.max(item.availableSlots.car, 2),
      twoWheeler: item.availableSlots.twoWheeler,
    },
    surgeMultiplier: item.surgeMultiplier,
    surgeBadge: item.surgeBadge,
    reviewCount: rated ? reviews.reviewSummary.ratingCount : 0,
    badge: rated ? { ...item.badge, reviewCount: reviews.reviewSummary.ratingCount } : item.badge,
    reviewSummary: rated
      ? reviews.reviewSummary
      : { ratingAvgBp: null, ratingCount: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    recentReviews: rated ? reviews.recentReviews : [],
    defaultBooking: null,
    owner: { name: 'Priya', memberSince: '2025-01-01T00:00:00.000Z' },
  });
}
