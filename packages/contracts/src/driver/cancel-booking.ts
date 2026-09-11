import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';

export const cancelBookingSchema = z.object({
  bookingId: bookingIdSchema,
  reason: z.string().min(1).max(500).optional(),
});

export type CancelBooking = z.infer<typeof cancelBookingSchema>;
