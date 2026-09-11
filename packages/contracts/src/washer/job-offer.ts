import { z } from 'zod';

import { washJobIdSchema, bookingIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const washJobOfferSchema = z.object({
  id: washJobIdSchema,
  bookingId: bookingIdSchema,
  spaceLocation: geoPointSchema,
  serviceType: z.string(),
  feePaise: paiseSchema,
  expiresAt: z.string().datetime(),
});

export type WashJobOffer = z.infer<typeof washJobOfferSchema>;
