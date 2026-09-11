import { z } from 'zod';

import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { vehicleNumberSchema } from '../primitives/indian.js';

export const addVehicleSchema = z.object({
  vehicleType: vehicleTypeSchema,
  vehicleNumber: vehicleNumberSchema,
  make: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  color: z.string().min(1).max(50).optional(),
});

export type AddVehicle = z.infer<typeof addVehicleSchema>;

export const vehicleSchema = z.object({
  id: z.string().uuid(),
  vehicleType: vehicleTypeSchema,
  vehicleNumber: vehicleNumberSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
