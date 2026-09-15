import { z } from 'zod';

/**
 * The booking id is a path parameter, not a body field — a body that can name a
 * different booking than the URL is an authorisation question nobody wants to
 * have to ask.
 */
export const extendBookingSchema = z.object({
  newEndsAt: z.string().datetime(),
});

export type ExtendBooking = z.infer<typeof extendBookingSchema>;
