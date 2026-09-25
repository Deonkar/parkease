import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseDeltaSchema } from '../primitives/paise.js';

export const OWNER_BOOKING_GROUP_VALUES = ['active', 'upcoming', 'past'] as const;
export const ownerBookingGroupSchema = z.enum(OWNER_BOOKING_GROUP_VALUES);
export type OwnerBookingGroup = z.infer<typeof ownerBookingGroupSchema>;

export const ownerBookingsQuerySchema = paginationQuerySchema.extend({
  group: ownerBookingGroupSchema.default('active'),
});
export type OwnerBookingsQuery = z.infer<typeof ownerBookingsQuerySchema>;

export const ownerBookingSchema = z
  .object({
    bookingId: bookingIdSchema,
    driverName: z.string(),
    vehicleType: vehicleTypeSchema,
    slotIndex: z.number().int().nonnegative().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: bookingStatusSchema,
    /** Ledger net on `owner_payable` for this booking. */
    earnedPaise: paiseDeltaSchema,
  })
  .strict();
export type OwnerBooking = z.infer<typeof ownerBookingSchema>;
