import { z } from 'zod';

import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, washJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

/**
 * An open offer, as the partner app lists it.
 *
 * `earningsPaise` is what the partner takes home — their price less our
 * commission — not the price and not the driver's total. Somebody deciding
 * whether a job is worth loading a van for needs the number that lands in their
 * account, and showing the gross would be a quiet overstatement on every card.
 *
 * The number is theirs specifically: it comes from *their* menu row for this
 * service and vehicle type, which is also why a partner who does not price that
 * combination is never a candidate for it in the first place.
 */
export const washJobOfferSchema = z.object({
  jobId: washJobIdSchema,
  bookingId: bookingIdSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  /** Where the car is. The partner travels to the space, not to the driver. */
  spaceLocation: geoPointSchema,
  distanceM: z.number().int().nonnegative(),
  earningsPaise: paiseSchema,
  offeredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type WashJobOffer = z.infer<typeof washJobOfferSchema>;
