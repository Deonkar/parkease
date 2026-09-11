import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';

export const checkInSchema = z.object({
  bookingId: bookingIdSchema,
  location: geoPointSchema.optional(),
});

export type CheckIn = z.infer<typeof checkInSchema>;
