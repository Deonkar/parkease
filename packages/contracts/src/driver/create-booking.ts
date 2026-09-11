import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, spaceIdSchema } from '../primitives/ids.js';
import { vehicleNumberSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

export const createBookingSchema = z
  .object({
    spaceId: spaceIdSchema,
    vehicleType: vehicleTypeSchema,
    durationType: durationTypeSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    vehicleNumber: vehicleNumberSchema.optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'End time must be after start time',
    path: ['endsAt'],
  })
  .refine((v) => new Date(v.startsAt).getTime() > Date.now() - 60_000, {
    message: 'You cannot book a time in the past',
    path: ['startsAt'],
  });

export type CreateBooking = z.infer<typeof createBookingSchema>;

export const quoteBreakdownSchema = z.object({
  basePaise: paiseSchema,
  surgePremiumPaise: paiseSchema,
  gstPaise: paiseSchema,
  totalPaise: paiseSchema,
  ownerEarningsPaise: paiseSchema,
  surgeMultiplierBp: z.number().int().min(10_000).max(30_000),
});

export type QuoteBreakdown = z.infer<typeof quoteBreakdownSchema>;

export const bookingDetailSchema = z.object({
  id: bookingIdSchema,
  spaceId: spaceIdSchema,
  status: bookingStatusSchema,
  vehicleType: vehicleTypeSchema,
  durationType: durationTypeSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  quote: quoteBreakdownSchema,
  createdAt: z.string().datetime(),
});

export type BookingDetail = z.infer<typeof bookingDetailSchema>;
