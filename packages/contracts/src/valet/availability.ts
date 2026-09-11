import { z } from 'zod';

import { geoPointSchema } from '../primitives/indian.js';

export const updateValetAvailabilitySchema = z.object({
  available: z.boolean(),
  location: geoPointSchema.optional(),
  radiusKm: z.number().min(0.5).max(25).optional(),
});

export type UpdateValetAvailability = z.infer<typeof updateValetAvailabilitySchema>;
