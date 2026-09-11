import { z } from 'zod';

import { valetJobIdSchema, bookingIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const valetJobOfferSchema = z.object({
  id: valetJobIdSchema,
  bookingId: bookingIdSchema,
  pickupLocation: geoPointSchema,
  spaceLocation: geoPointSchema,
  feePaise: paiseSchema,
  expiresAt: z.string().datetime(),
});

export type ValetJobOffer = z.infer<typeof valetJobOfferSchema>;
