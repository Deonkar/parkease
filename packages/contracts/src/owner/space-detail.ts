import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { approvalStatusSchema } from '../enums/approval-status.js';

import { spacePricingSchema } from './space-pricing.js';
import { spaceScheduleSchema } from './space-schedule.js';

const photoResponseSchema = z.object({
  publicId: z.string(),
  url: z.string(),
  displayOrder: z.number().int(),
  isPrimary: z.boolean(),
});

const slotSummarySchema = z.object({
  car: z.number().int().min(0),
  twoWheeler: z.number().int().min(0),
});

export const spaceSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  city: z.string(),
  approvalStatus: approvalStatusSchema,
  slots: slotSummarySchema,
  primaryPhoto: photoResponseSchema.nullable(),
  createdAt: z.string().datetime(),
});

export const spaceDetailSchema = spaceSummarySchema.extend({
  description: z.string().nullable(),
  addressLine: z.string(),
  landmark: z.string().nullable(),
  pincode: z.string(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  pricing: spacePricingSchema,
  schedule: spaceScheduleSchema,
  amenities: z.array(amenitySchema),
  accessInstructions: z.string().nullable(),
  photos: z.array(photoResponseSchema),
  submittedAt: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
});

export type SpaceSummary = z.infer<typeof spaceSummarySchema>;
export type SpaceDetail = z.infer<typeof spaceDetailSchema>;
export type PhotoResponse = z.infer<typeof photoResponseSchema>;
