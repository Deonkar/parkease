import { z } from 'zod';

import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { geoPointSchema, pincodeSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const spaceSlotConfigSchema = z.object({
  vehicleType: vehicleTypeSchema,
  totalSlots: z.number().int().min(1).max(1000),
});

export const spacePricingSchema = z.object({
  vehicleType: vehicleTypeSchema,
  durationType: durationTypeSchema,
  pricePaise: paiseSchema,
});

export const createSpaceSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  pincode: pincodeSchema,
  location: geoPointSchema,
  description: z.string().max(2000).optional(),
  amenities: z.array(z.string().min(1).max(100)).max(20).optional(),
  slots: z.array(spaceSlotConfigSchema).min(1),
  pricing: z.array(spacePricingSchema).min(1),
  images: z.array(z.string().url()).max(10).optional(),
});

export type CreateSpace = z.infer<typeof createSpaceSchema>;
