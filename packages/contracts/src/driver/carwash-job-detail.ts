import { z } from 'zod';

import { carwashJobStatusSchema } from '../enums/carwash-job-status.js';
import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, userIdSchema, washJobIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';
import { washerPartnerTypeSchema } from '../washer/profile.js';

/**
 * The partner, as a driver is allowed to see them.
 *
 * Columns are named one by one rather than spread from a row, because
 * `washer_profiles` joins `users`, which holds a phone number — and a `SELECT *`
 * here is one careless spread away from putting it in a response
 * (security.md §5.3). No phone number, in any variant of this product.
 */
export const washerCardSchema = z.object({
  userId: userIdSchema,
  name: z.string(),
  partnerType: washerPartnerTypeSchema,
  businessName: z.string().nullable(),
  ratingAvgBp: z.number().int().nullable(),
  ratingCount: z.number().int().nonnegative(),
});

export type WasherCard = z.infer<typeof washerCardSchema>;

/**
 * A wash, as its driver sees it.
 *
 * `pricePaise` and `driverTotalPaise` are null until a partner accepts, because
 * until then no menu has been consulted and there is no number to show. A
 * screen that renders ₹0 in that window is telling the driver something untrue.
 */
export const driverWashJobSchema = z.object({
  id: washJobIdSchema,
  bookingId: bookingIdSchema,
  status: carwashJobStatusSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  pricePaise: paiseSchema.nullable(),
  gstPaise: paiseSchema.nullable(),
  driverTotalPaise: paiseSchema.nullable(),
  /** How many partners were asked. Not who — that is a map of our supply. */
  offeredTo: z.number().int().nonnegative(),
  offerRadiusM: z.number().int().positive(),
  offerRound: z.number().int().nonnegative(),
  washer: washerCardSchema.nullable(),
  beforePhotoId: z.string().nullable(),
  afterPhotoId: z.string().nullable(),
  /** Whether a cancel button should exist at all. Server-decided (§13.9). */
  cancellable: z.boolean(),
  cancellationReason: z.string().nullable(),
  requestedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export type DriverWashJob = z.infer<typeof driverWashJobSchema>;
