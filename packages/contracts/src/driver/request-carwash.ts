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

/**
 * The Checkout handoff for a car wash.
 *
 * A sibling of `paymentOrderSchema` rather than a reuse of it, because the two
 * differ in what the fields *mean*. A booking order is described by the space
 * being parked in and keyed to a booking; a wash order is described by the
 * service being bought and keyed to a wash job. Passing one where the other
 * belongs would render "Premium Wash" as a space name, or send a driver's
 * payment to reconcile against the wrong row — mistakes that typecheck
 * perfectly if the shapes are shared.
 */
export const washPaymentOrderSchema = z.object({
  razorpayOrderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  /** Publishable by design. The secret never leaves the server (R-ENV-05). */
  keyId: z.string().min(1),
  /** Shown as the Checkout description, so the driver knows what they are buying. */
  serviceLabel: z.string().min(1),
  washJobId: washJobIdSchema,
});

export type WashPaymentOrder = z.infer<typeof washPaymentOrderSchema>;
