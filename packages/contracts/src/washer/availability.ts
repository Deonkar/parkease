import { z } from 'zod';

import { geoPointSchema } from '../primitives/indian.js';

export const updateWasherAvailabilitySchema = z.object({
  available: z.boolean(),
  location: geoPointSchema.optional(),
  radiusKm: z.number().min(0.5).max(25).optional(),
});

export type UpdateWasherAvailability = z.infer<typeof updateWasherAvailabilitySchema>;
