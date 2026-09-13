import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { pincodeSchema } from '../primitives/indian.js';

import { slotCountsSchema } from './slot-counts.js';
import { spacePricingSchema } from './space-pricing.js';
import { spaceScheduleSchema } from './space-schedule.js';

export const MAX_PHOTOS_PER_SPACE = 5;

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

const baseCreateSpaceSchema = z.object({
  title: z.string().trim().min(4).max(80),
  description: z.string().trim().max(1000).optional(),
  address: addressSchema,
  location: latLngSchema,
  slots: slotCountsSchema,
  pricing: spacePricingSchema,
  schedule: spaceScheduleSchema,
  amenities: z.array(amenitySchema).max(6).default([]),
  accessInstructions: z.string().trim().max(500).optional(),
});

export const createSpaceSchema = baseCreateSpaceSchema
  .refine((v) => v.slots.car === 0 || v.pricing.car !== undefined, {
    path: ['pricing', 'car'],
    message: 'Set car pricing, or set car slots to 0',
  })
  .refine((v) => v.slots.twoWheeler === 0 || v.pricing.twoWheeler !== undefined, {
    path: ['pricing', 'twoWheeler'],
    message: 'Set two-wheeler pricing, or set two-wheeler slots to 0',
  });

export type CreateSpace = z.infer<typeof createSpaceSchema>;
