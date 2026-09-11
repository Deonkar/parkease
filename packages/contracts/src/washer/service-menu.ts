import { z } from 'zod';

import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { paiseSchema } from '../primitives/paise.js';

export const serviceItemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  vehicleType: vehicleTypeSchema,
  pricePaise: paiseSchema,
  durationMinutes: z.number().int().min(5).max(480),
});

export type ServiceItem = z.infer<typeof serviceItemSchema>;

export const updateServiceMenuSchema = z.object({
  services: z.array(serviceItemSchema).min(1).max(50),
});

export type UpdateServiceMenu = z.infer<typeof updateServiceMenuSchema>;
