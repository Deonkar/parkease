import { z } from 'zod';

import { valetJobStatusSchema } from '../enums/valet-job-status.js';
import { bookingIdSchema, valetJobIdSchema, userIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';
import { valetLocationViewSchema } from '../valet/tracking-events.js';

/**
 * The valet, as a driver is allowed to see them.
 *
 * No phone number, at any point, flag on or off. Masked calling is what stops a
 * number being exchanged at all (§11.9, security.md §5.3), so "we will show it
 * once the provider is ready" is not the fallback — there is no version of this
 * product where a driver reads a valet's number off an API response.
 */
export const valetCardSchema = z.object({
  userId: userIdSchema,
  name: z.string(),
  vehicleMake: z.string().nullable(),
  vehicleNumber: z.string().nullable(),
  ratingAvgBp: z.number().int().nullable(),
  ratingCount: z.number().int().nonnegative(),
});

export type ValetCard = z.infer<typeof valetCardSchema>;

/**
 * How to reach the other party, as a mode rather than a number.
 *
 * A discriminated union so the two are mutually exclusive by construction: a
 * response can carry a masked-call handle or a support thread, never both, and
 * never a raw number. Until a telephony provider is selected the only inhabited
 * variant is `support` (§11.9).
 */
export const valetContactSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('support'), threadUrl: z.string() }),
  z.object({ mode: z.literal('masked_call'), callToken: z.string() }),
]);

export type ValetContact = z.infer<typeof valetContactSchema>;

const legSchema = z.object({
  distanceM: z.number().int().nonnegative().nullable(),
  feePaise: paiseSchema.nullable(),
  txnId: z.string().uuid().nullable(),
});

export const driverValetJobSchema = z.object({
  id: valetJobIdSchema,
  bookingId: bookingIdSchema,
  status: valetJobStatusSchema,
  pickupAddress: z.string(),
  offerRadiusM: z.number().int().positive(),
  offerRound: z.number().int().nonnegative(),
  /** How many valets were asked. Not who — that is nobody's business but ours. */
  offeredTo: z.number().int().nonnegative(),
  outboundLeg: legSchema,
  returnLeg: legSchema,
  returnDropLocation: geoPointSchema.nullable(),
  valet: valetCardSchema.nullable(),
  contact: valetContactSchema.nullable(),
  /** The last fix, replayed so a late-joining map is not empty. */
  lastKnownLocation: valetLocationViewSchema.nullable(),
  /** Whether a cancel button should exist at all. Server-decided (§11.2). */
  cancellable: z.boolean(),
  proofPhotoId: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  requestedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  parkedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export type DriverValetJob = z.infer<typeof driverValetJobSchema>;
