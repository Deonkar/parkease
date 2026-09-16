import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { surgeBadgeSchema } from '../enums/surge-badge.js';
import { spaceScheduleSchema } from '../owner/space-schedule.js';
import { spaceIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

/**
 * Base rates only, exactly as the owner set them. No fee, no GST, no surge
 * arithmetic: the driver-facing pricing table on space detail shows what an hour
 * costs, and the full breakdown appears once — at Review & Pay (ADR-009).
 */
export const driverRateCardSchema = z.object({
  hourlyPaise: paiseSchema.nullable(),
  dailyPaise: paiseSchema.nullable(),
  weeklyPaise: paiseSchema.nullable(),
  monthlyPaise: paiseSchema.nullable(),
});

export type DriverRateCard = z.infer<typeof driverRateCardSchema>;

export const spacePhotoSchema = z.object({
  url: z.string().url(),
  isPrimary: z.boolean(),
});

export type SpacePhoto = z.infer<typeof spacePhotoSchema>;

/**
 * The booking this space would sell you right now, already priced by the server.
 *
 * This exists so the space detail screen can put a real total on its primary
 * button without the client multiplying anything. A client-side `rate × hours`
 * would both break R-FE-06 and be wrong: it would promise ₹60 for a window that
 * actually costs ₹97.02 once surge and GST land, which is a worse failure than
 * showing no number at all.
 *
 * `null` when there is nothing to offer — no free slot, or no rate card for any
 * vehicle type the space has.
 */
export const defaultBookingSchema = z.object({
  vehicleType: z.enum(['car', 'two_wheeler']),
  durationType: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  hours: z.number().int().positive(),
  quote: z.object({
    basePaise: paiseSchema,
    surgePremiumPaise: paiseSchema,
    gstPaise: paiseSchema,
    totalPaise: paiseSchema,
    ownerEarningsPaise: paiseSchema,
    surgeMultiplierBp: z.number().int(),
  }),
});

export type DefaultBooking = z.infer<typeof defaultBookingSchema>;

export const spaceDetailSchema = z.object({
  id: spaceIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  addressLine: z.string(),
  landmark: z.string().nullable(),
  city: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  photos: z.array(spacePhotoSchema),
  amenities: z.array(amenitySchema),
  schedule: spaceScheduleSchema,
  isOpenNow: z.boolean(),
  pricing: z.object({
    car: driverRateCardSchema.nullable(),
    twoWheeler: driverRateCardSchema.nullable(),
  }),
  /** Free right now, per vehicle type. Never cached — availability is live. */
  availableNow: z.object({
    car: z.number().int().nonnegative(),
    twoWheeler: z.number().int().nonnegative(),
  }),
  totalSlots: z.object({
    car: z.number().int().nonnegative(),
    twoWheeler: z.number().int().nonnegative(),
  }),
  /** Displayed, never applied. The client does not compute prices (R-FE-06). */
  surgeMultiplier: z.number(),
  /** The tier, or null when the zone is not surging. Drives the §2.6 banner. */
  surgeBadge: surgeBadgeSchema.nullable(),
  /** null means never reviewed — the client renders "New", never a zero score. */
  rating: z.number().nullable(),
  reviewCount: z.number().int().nonnegative(),
  defaultBooking: defaultBookingSchema.nullable(),
  owner: z.object({
    name: z.string(),
    memberSince: z.string().datetime(),
  }),
});

export type SpaceDetail = z.infer<typeof spaceDetailSchema>;
