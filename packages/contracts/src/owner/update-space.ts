import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { pincodeSchema } from '../primitives/indian.js';

import { slotCountsSchema } from './slot-counts.js';
import { spacePricingSchema } from './space-pricing.js';
import { spaceScheduleSchema } from './space-schedule.js';

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const addressSchema = z.object({
  line: z.string().trim().min(8).max(200),
  landmark: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(60),
  pincode: pincodeSchema,
});

const baseUpdateSpaceSchema = z.object({
  title: z.string().trim().min(4).max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  address: addressSchema.optional(),
  location: latLngSchema.optional(),
  slots: slotCountsSchema.optional(),
  pricing: spacePricingSchema.optional(),
  schedule: spaceScheduleSchema.optional(),
  amenities: z.array(amenitySchema).max(6).optional(),
  accessInstructions: z.string().trim().max(500).optional(),
});

export const updateSpaceSchema = baseUpdateSpaceSchema.refine(
  (v) => {
    if (v.slots === undefined || v.pricing === undefined) return true;
    if (v.slots.car > 0 && v.pricing.car === undefined) return false;
    if (v.slots.twoWheeler > 0 && v.pricing.twoWheeler === undefined) return false;
    return true;
  },
  { message: 'Pricing must cover every vehicle type that has slots' },
);

export type UpdateSpace = z.infer<typeof updateSpaceSchema>;
