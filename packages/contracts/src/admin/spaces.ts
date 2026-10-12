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

/**
 * The `updatedAt` of the version the admin looked at (S-142). A decision on a listing the owner
 * changed since is refused (409 `SPACE_CHANGED`), so nobody approves photos or a price they never
 * saw. Required to approve; reject and request-changes accept it.
 */
const expectedUpdatedAt = z.string().datetime();

export const spaceApproveSchema = z.object({ expectedUpdatedAt });

export type SpaceApprove = z.infer<typeof spaceApproveSchema>;

/** Reject and request-changes both owe the owner an explanation. */
export const spaceDecisionNotesSchema = z.object({
  notes: z.string().trim().min(1).max(1000),
  expectedUpdatedAt: expectedUpdatedAt.optional(),
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
  /** The version: sent back as `expectedUpdatedAt` with a decision. */
  updatedAt: z.string().datetime(),
});

export type AdminSpaceDetail = z.infer<typeof adminSpaceDetailSchema>;

/** What every decision answers (S-142: it had no contract). */
export const adminSpaceDecisionResultSchema = z.object({
  id: spaceIdSchema,
  approvalStatus: approvalStatusSchema,
});

export type AdminSpaceDecisionResult = z.infer<typeof adminSpaceDecisionResultSchema>;
