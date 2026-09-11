import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';

export const createValetRequestSchema = z.object({
  bookingId: bookingIdSchema,
  pickupLocation: geoPointSchema,
  notes: z.string().max(500).optional(),
});

export type CreateValetRequest = z.infer<typeof createValetRequestSchema>;
