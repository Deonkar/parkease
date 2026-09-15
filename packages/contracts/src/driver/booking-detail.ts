import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { checkInMethodSchema } from '../enums/check-in-method.js';
import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, spaceIdSchema } from '../primitives/ids.js';
import { cursorPageMetaSchema } from '../primitives/pagination.js';

import { quoteBreakdownSchema } from './create-booking.js';

/**
 * Enough of the space to render a booking card without a second request. Not the
 * full space detail: a booking list that fetches pricing, photos and reviews for
 * every row is how a list screen becomes slow.
 */
export const bookingSpaceSummarySchema = z.object({
  id: spaceIdSchema,
  title: z.string(),
  addressLine: z.string(),
  landmark: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});

export type BookingSpaceSummary = z.infer<typeof bookingSpaceSummarySchema>;

/**
 * The QR token is a signed booking reference, not a URL. The app renders the
 * code locally from this string so it still scans in a basement with no signal
 * (R-FE-11), and it is present only while a scan could still do something.
 */
export const driverBookingSchema = z.object({
  id: bookingIdSchema,
  status: bookingStatusSchema,
  space: bookingSpaceSummarySchema,
  vehicleType: vehicleTypeSchema,
  vehicleNumber: z.string().nullable(),
  durationType: durationTypeSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  slotIndex: z.number().int().nonnegative().nullable(),
  quote: quoteBreakdownSchema,
  qrToken: z.string().nullable(),
  checkedInAt: z.string().datetime().nullable(),
  checkInMethod: checkInMethodSchema.nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
  /** Presentational only — the server owns expiry (R-FE-06). */
  paymentDeadlineAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type DriverBooking = z.infer<typeof driverBookingSchema>;

export const driverBookingsPageSchema = z.object({
  items: z.array(driverBookingSchema),
  meta: cursorPageMetaSchema,
});

export type DriverBookingsPage = z.infer<typeof driverBookingsPageSchema>;
