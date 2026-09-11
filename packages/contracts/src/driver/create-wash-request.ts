import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';

export const createWashRequestSchema = z.object({
  bookingId: bookingIdSchema,
  serviceType: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export type CreateWashRequest = z.infer<typeof createWashRequestSchema>;
