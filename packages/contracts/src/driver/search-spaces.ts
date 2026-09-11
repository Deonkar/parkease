import { z } from 'zod';

import { approvalStatusSchema } from '../enums/approval-status.js';
import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { spaceIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const searchSpacesSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(50).default(5),
  vehicleType: vehicleTypeSchema,
  durationType: durationTypeSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type SearchSpaces = z.infer<typeof searchSpacesSchema>;

export const spaceResultSchema = z.object({
  id: spaceIdSchema,
  name: z.string(),
  address: z.string(),
  location: geoPointSchema,
  distanceKm: z.number(),
  status: approvalStatusSchema,
  basePricePaise: paiseSchema,
  surgeMultiplierBp: z.number().int().min(10_000).max(30_000),
  availableSlots: z.number().int().nonnegative(),
  rating: z.number().min(0).max(5).nullable(),
  imageUrl: z.string().url().nullable(),
});

export type SpaceResult = z.infer<typeof spaceResultSchema>;
