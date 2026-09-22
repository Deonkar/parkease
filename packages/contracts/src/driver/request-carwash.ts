import { z } from 'zod';

import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, washJobIdSchema } from '../primitives/ids.js';

/**
 * Adding a wash to a booking whose car is already parked.
 *
 * **There is no price here, and there cannot be.** The amount depends on which
 * partner wins the offer race and what they charge for this service and this
 * vehicle type, so it is not known when the request is made and is frozen onto
 * the job at accept. A request that could name a price would be a request that
 * could name zero (R-FE-05: the client never computes a price).
 *
 * The vehicle type is the driver's, not the space's: the same booking could be
 * a car today and a two-wheeler next week, and the menu is priced per type.
 */
export const requestCarwashSchema = z.object({
  bookingId: bookingIdSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
});

export type RequestCarwash = z.infer<typeof requestCarwashSchema>;

export const cancelCarwashSchema = z.object({
  reason: z.string().max(255).optional(),
});

export type CancelCarwash = z.infer<typeof cancelCarwashSchema>;

export const washJobIdParamSchema = z.object({ id: washJobIdSchema });
