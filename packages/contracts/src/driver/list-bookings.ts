import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { paginationQuerySchema } from '../primitives/pagination.js';

/**
 * `upcoming` and `past` are the two tabs a driver actually thinks in, and the
 * split is by status rather than by clock: a booking whose window has passed but
 * which was never checked into is still unresolved, not history.
 */
export const BOOKING_FILTER_VALUES = ['all', 'upcoming', 'past'] as const;
export const bookingFilterSchema = z.enum(BOOKING_FILTER_VALUES);
export type BookingFilter = z.infer<typeof bookingFilterSchema>;

export const listBookingsQuerySchema = paginationQuerySchema.extend({
  filter: bookingFilterSchema.default('all'),
  status: bookingStatusSchema.optional(),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
