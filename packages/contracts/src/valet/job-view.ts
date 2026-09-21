import { z } from 'zod';

import { valetJobStatusSchema } from '../enums/valet-job-status.js';
import { bookingIdSchema, valetJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

/**
 * An open offer, as the valet app lists it.
 *
 * `earningsPaise` is what the valet takes home — fee less commission — not the
 * fee and not the driver's total. A partner deciding whether a job is worth
 * driving to needs the number that lands in their account, and showing them the
 * gross would be a quiet overstatement on every single card.
 */
export const valetOfferSchema = z.object({
  jobId: valetJobIdSchema,
  bookingId: bookingIdSchema,
  pickupAddress: z.string(),
  pickupLocation: geoPointSchema,
  distanceM: z.number().int().nonnegative(),
  earningsPaise: paiseSchema,
  offeredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type ValetOffer = z.infer<typeof valetOfferSchema>;

/** The one live job a valet is on. */
export const valetJobViewSchema = z.object({
  id: valetJobIdSchema,
  bookingId: bookingIdSchema,
  status: valetJobStatusSchema,
  pickupAddress: z.string(),
  pickupLocation: geoPointSchema,
  returnDropLocation: geoPointSchema.nullable(),
  distanceM: z.number().int().nonnegative().nullable(),
  earningsPaise: paiseSchema.nullable(),
  returnEarningsPaise: paiseSchema.nullable(),
  /** Which events the machine will accept next, so the app renders one button. */
  availableEvents: z.array(z.string()),
  proofPhotoId: z.string().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  arrivedAt: z.string().datetime().nullable(),
  parkedAt: z.string().datetime().nullable(),
});

export type ValetJobView = z.infer<typeof valetJobViewSchema>;

/**
 * Ledger-derived, gross and net.
 *
 * Three numbers rather than two, because gross and net differ for a reason a
 * partner is owed an explanation of: a job cancelled after dispatch or ended in
 * a no-show claws part of a credited leg back, and a screen showing only the net
 * leaves them unable to see that a reversal happened at all.
 *
 * There is deliberately no `commissionPaise` here. Commission is credited to
 * `platform_revenue`, not to this account, so reporting it would mean either a
 * second query or quietly relabelling the clawback total as commission — and a
 * wrong label on a money screen is worse than an absent one.
 */
export const valetEarningsSummarySchema = z.object({
  /** Credits to this valet across every leg, before any reversal. */
  grossPaise: paiseSchema,
  /** Debits: the part of a leg clawed back on a cancel or a no-show. */
  reversedPaise: paiseSchema,
  /** What the ledger says we owe this valet right now. */
  netPaise: paiseSchema,
  jobsCompleted: z.number().int().nonnegative(),
});

export type ValetEarningsSummary = z.infer<typeof valetEarningsSummarySchema>;

export const valetProfileViewSchema = z.object({
  verificationStatus: z.string(),
  backgroundCheckStatus: z.string(),
  licenceDocumentId: z.string().nullable(),
  licenceExpiresAt: z.string().datetime().nullable(),
  isOnline: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
  vehicleMake: z.string().nullable(),
  vehicleNumber: z.string().nullable(),
  ratingAvgBp: z.number().int().nullable(),
  ratingCount: z.number().int().nonnegative(),
});

export type ValetProfileView = z.infer<typeof valetProfileViewSchema>;
