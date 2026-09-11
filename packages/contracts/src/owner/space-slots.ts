import { z } from 'zod';

import { slotStatusSchema } from '../enums/slot-status.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { spaceIdSchema, spaceSlotIdSchema } from '../primitives/ids.js';

export const spaceSlotQuerySchema = z.object({
  spaceId: spaceIdSchema,
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type SpaceSlotQuery = z.infer<typeof spaceSlotQuerySchema>;

export const spaceSlotSchema = z.object({
  id: spaceSlotIdSchema,
  spaceId: spaceIdSchema,
  vehicleType: vehicleTypeSchema,
  slotIndex: z.number().int().nonnegative(),
  status: slotStatusSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type SpaceSlot = z.infer<typeof spaceSlotSchema>;
