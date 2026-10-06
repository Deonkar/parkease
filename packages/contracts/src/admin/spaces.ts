import { z } from 'zod';

import { amenitySchema } from '../enums/amenity.js';
import { approvalStatusSchema } from '../enums/approval-status.js';
import { spacePricingSchema } from '../owner/space-pricing.js';
import { spaceScheduleSchema } from '../owner/space-schedule.js';
import { spaceIdSchema, userIdSchema } from '../primitives/ids.js';

import { adminPageQuerySchema } from './query.js';

export const ADMIN_SPACE_DECISION_VALUES = ['approve', 'reject', 'request_changes'] as const;

export const adminSpaceDecisionSchema = z.enum(ADMIN_SPACE_DECISION_VALUES);
export type AdminSpaceDecision = z.infer<typeof adminSpaceDecisionSchema>;

/** Reject and request-changes both owe the owner an explanation. Approve takes no body. */
export const spaceDecisionNotesSchema = z.object({
  notes: z.string().trim().min(1).max(1000),
});

export type SpaceDecisionNotes = z.infer<typeof spaceDecisionNotesSchema>;

export const adminSpaceQueueQuerySchema = adminPageQuerySchema.extend({
  status: approvalStatusSchema.default('pending_approval'),
});

export type AdminSpaceQueueQuery = z.infer<typeof adminSpaceQueueQuerySchema>;

export const adminSpaceQueueItemSchema = z.object({
  id: spaceIdSchema,
  title: z.string(),
  address: z.string(),
  ownerId: userIdSchema,
  ownerName: z.string().nullable(),
  /** `maskPhone` output. */
  ownerPhone: z.string(),
  isFirstListing: z.boolean(),
  approvalStatus: approvalStatusSchema,
  submittedAt: z.string().datetime(),
  reviewNotes: z.string().nullable(),
});

export type AdminSpaceQueueItem = z.infer<typeof adminSpaceQueueItemSchema>;

export const adminSpaceDetailSchema = adminSpaceQueueItemSchema.extend({
  description: z.string().nullable(),
  photos: z.array(z.string()),
  pricing: spacePricingSchema,
  schedule: spaceScheduleSchema,
  amenities: z.array(amenitySchema),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoneId: z.string(),
  reviewedAt: z.string().datetime().nullable(),
});

export type AdminSpaceDetail = z.infer<typeof adminSpaceDetailSchema>;
