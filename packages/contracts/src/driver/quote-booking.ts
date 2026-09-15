import { z } from 'zod';

import { durationTypeSchema } from '../enums/duration-type.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { spaceIdSchema } from '../primitives/ids.js';

import { quoteBreakdownSchema } from './create-booking.js';

/**
 * Prices a window without reserving anything.
 *
 * It exists because Review & Pay has to show the breakdown *before* the driver
 * commits, and the only other way to obtain a server price is to create the
 * booking — which holds a slot. Quoting on arrival at a screen the driver may
 * abandon would take spots off the market for ten minutes at a time.
 *
 * The client cannot compute this itself (R-FE-06): base × hours is not the
 * price, because surge and GST land on top of it.
 */
export const quoteBookingSchema = z
  .object({
    spaceId: spaceIdSchema,
    vehicleType: vehicleTypeSchema,
    durationType: durationTypeSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'End time must be after start time',
    path: ['endsAt'],
  });

export type QuoteBooking = z.infer<typeof quoteBookingSchema>;

export const quoteResultSchema = z.object({
  quote: quoteBreakdownSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type QuoteResult = z.infer<typeof quoteResultSchema>;
