import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { bookingIdSchema, spaceIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseSchema } from '../primitives/paise.js';

export const ownerBookingsQuerySchema = paginationQuerySchema.extend({
  spaceId: spaceIdSchema.optional(),
  status: bookingStatusSchema.optional(),
});

export type OwnerBookingsQuery = z.infer<typeof ownerBookingsQuerySchema>;

export const ownerBookingSchema = z.object({
  id: bookingIdSchema,
  spaceId: spaceIdSchema,
  status: bookingStatusSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  earningsPaise: paiseSchema,
  createdAt: z.string().datetime(),
});

export type OwnerBooking = z.infer<typeof ownerBookingSchema>;
