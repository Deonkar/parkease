import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { SURGE_MULTIPLIER_MAX, SURGE_MULTIPLIER_MIN } from '../money/rates.js';
import { spaceIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const DEFAULT_SEARCH_RADIUS_M = 5_000;
export const MAX_SEARCH_RADIUS_M = 25_000;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
export const MAX_SEARCH_AMENITIES = 6;
export const MAX_CURSOR_LENGTH = 256;

export const searchSortSchema = z.enum(['distance', 'price', 'rating']);
export type SearchSort = z.infer<typeof searchSortSchema>;

/**
 * Query parameters arrive as strings, so paise bounds coerce. `.int()` still
 * rejects a fractional amount — money is integer paise on the way in too
 * (rules.md R-MON-01).
 */
const queryPaiseSchema = z.coerce.number().int().nonnegative().brand<'Paise'>();

export const searchSpacesQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusM: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_SEARCH_RADIUS_M)
      .default(DEFAULT_SEARCH_RADIUS_M),
    vehicleType: vehicleTypeSchema.optional(),
    durationType: durationTypeSchema.default('hourly'),
    minPricePaise: queryPaiseSchema.optional(),
    maxPricePaise: queryPaiseSchema.optional(),
    amenities: z
      .string()
      .transform((csv) =>
        csv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(amenitySchema).max(MAX_SEARCH_AMENITIES))
      .default(''),
    minRating: z.coerce.number().min(1).max(5).optional(),
    sortBy: searchSortSchema.default('distance'),
    cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
  })
  .refine(
    (q) =>
      q.minPricePaise === undefined ||
      q.maxPricePaise === undefined ||
      q.minPricePaise <= q.maxPricePaise,
    { path: ['maxPricePaise'], message: 'Maximum price must be at least the minimum' },
  );

export type SearchSpacesQuery = z.infer<typeof searchSpacesQuerySchema>;

export const spaceSearchItemSchema = z.object({
  id: spaceIdSchema,
  title: z.string(),
  addressLine: z.string(),
  location: geoPointSchema,
  distanceM: z.number().int(),
  thumbnail: z.string().url().nullable(),
  /** null means never reviewed — the client renders "New", never a zero score. */
  rating: z.number().min(1).max(5).nullable(),
  reviewCount: z.number().int().nonnegative(),
  amenities: z.array(amenitySchema),
  availableSlots: z.object({
    car: z.number().int().nonnegative(),
    twoWheeler: z.number().int().nonnegative(),
  }),
  basePricePaise: paiseSchema,
  surgeMultiplier: z.number().min(SURGE_MULTIPLIER_MIN).max(SURGE_MULTIPLIER_MAX),
  /** basePricePaise x surgeMultiplier. Base plus surge, never GST (ADR-009). */
  effectivePricePaise: paiseSchema,
  isOpenNow: z.boolean(),
});

export type SpaceSearchItem = z.infer<typeof spaceSearchItemSchema>;
