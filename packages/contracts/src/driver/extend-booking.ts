import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';

export const extendBookingSchema = z.object({
  bookingId: bookingIdSchema,
  newEndsAt: z.string().datetime(),
});

export type ExtendBooking = z.infer<typeof extendBookingSchema>;
