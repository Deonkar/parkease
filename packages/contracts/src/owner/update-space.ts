import { z } from 'zod';

import { spaceIdSchema } from '../primitives/ids.js';
import { geoPointSchema, pincodeSchema } from '../primitives/indian.js';

import { spaceSlotConfigSchema, spacePricingSchema } from './create-space.js';

export const updateSpaceSchema = z.object({
  spaceId: spaceIdSchema,
  name: z.string().min(1).max(200).optional(),
  address: z.string().min(1).max(500).optional(),
  pincode: pincodeSchema.optional(),
  location: geoPointSchema.optional(),
  description: z.string().max(2000).optional(),
  amenities: z.array(z.string().min(1).max(100)).max(20).optional(),
  slots: z.array(spaceSlotConfigSchema).min(1).optional(),
  pricing: z.array(spacePricingSchema).min(1).optional(),
  images: z.array(z.string().url()).max(10).optional(),
});

export type UpdateSpace = z.infer<typeof updateSpaceSchema>;
