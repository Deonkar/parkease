import { spaceSearchItemSchema, type SpaceSearchItem } from '@parkease/contracts/driver';
import type { Amenity, SurgeBadge } from '@parkease/contracts/enums';

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
    rating,
    reviewCount,
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
  if (minRating !== undefined && (item.rating === null || item.rating < minRating)) return false;

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

function compare(sortBy: string | undefined, a: SpaceSearchItem, b: SpaceSearchItem): number {
  if (sortBy === 'price') return a.effectivePricePaise - b.effectivePricePaise;
  if (sortBy === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
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
