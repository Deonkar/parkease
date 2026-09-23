import { z } from 'zod';

import {
  CARWASH_SERVICE_NAME_VALUES,
  carwashServiceNameSchema,
} from '../enums/carwash-service-name.js';
import { verificationStatusSchema } from '../enums/verification-status.js';

export const WASHER_PARTNER_TYPE_VALUES = ['business', 'gig'] as const;
export const washerPartnerTypeSchema = z.enum(WASHER_PARTNER_TYPE_VALUES);
export type WasherPartnerType = z.infer<typeof washerPartnerTypeSchema>;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDaySchema = z.string().regex(TIME_OF_DAY, 'a time as HH:mm');

/**
 * When a partner is open, by weekday.
 *
 * A map rather than an array of rows, because "what are Monday's hours" is the
 * only question anything asks of it, and a partial map says "closed on the days
 * that are absent" without a third state. Stored as `jsonb`, so a day added
 * later is not a migration.
 */
export const operatingHoursSchema = z
  .object({
    mon: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    tue: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    wed: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    thu: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    fri: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    sat: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
    sun: z.object({ open: timeOfDaySchema, close: timeOfDaySchema }).optional(),
  })
  .strict();

export type OperatingHours = z.infer<typeof operatingHoursSchema>;

/**
 * Registering as a car wash partner, business or gig. §13.10.
 *
 * One schema with a discriminating field rather than two, because both land in
 * one `washer_profiles` row and take the same assignment path — the difference
 * is what they must supply, not what they become. `superRefine` puts the
 * business-photo rule on the field it concerns, so the error names
 * `businessPhotoIds` rather than "invalid input".
 *
 * A business must show at least one photo (ruling T10-C1): its registration is
 * a complete submission for review, and the photos are what is reviewed. A gig
 * partner's review material is the ID image sent afterwards.
 *
 * **There is no field for an identity number, deliberately.** security.md §5.3:
 * the Aadhaar number is never collected. A gig partner submits an *image* of an
 * ID that an admin looks at, through `POST /washer/profile/documents`, and the
 * number never enters the system at all. A nullable `aadhaarNumber` column that
 * "nobody fills in" is how it eventually gets filled in.
 */
export const createWasherProfileSchema = z
  .object({
    partnerType: washerPartnerTypeSchema,
    /**
     * The name the partner trades under, and what a driver sees on the washer
     * card: a business's business name, a gig partner's own name. Required for
     * both (ruling T10-C2) — nothing else captures a display name.
     */
    businessName: z.string().trim().min(1).max(120),
    /** Optional for a business, meaningless for a gig partner. */
    gstin: z
      .string()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'not a GSTIN')
      .optional(),
    businessPhotoIds: z.array(z.string().min(1).max(255)).max(10).default([]),
    operatingHours: operatingHoursSchema.optional(),
    /**
     * The services this partner offers, from the closed catalogue (ruling
     * T10-S1). Registration seeds prices for every service and switches on only
     * these, so this list is what decides which offers they see. A free string
     * would let a typo silently switch a service off.
     */
    capabilities: z
      .array(carwashServiceNameSchema)
      .min(1)
      .max(CARWASH_SERVICE_NAME_VALUES.length)
      .refine((names) => new Set(names).size === names.length, 'a service listed twice'),
  })
  .superRefine((value, ctx) => {
    if (value.partnerType === 'business' && value.businessPhotoIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessPhotoIds'],
        message: 'Add at least one photo of your business.',
      });
    }
  });

export type CreateWasherProfile = z.infer<typeof createWasherProfileSchema>;

/**
 * An ID image for review, never a number.
 *
 * Submitting moves verification back to `pending` and takes the partner
 * offline, for the reason the valet equivalent does: re-submitting while online
 * would leave somebody in the candidate pool on the strength of the document
 * they are replacing.
 */
export const submitWasherDocumentsSchema = z.object({
  idDocumentId: z.string().min(1).max(255),
  businessPhotoIds: z.array(z.string().min(1).max(255)).max(10).optional(),
});

export type SubmitWasherDocuments = z.infer<typeof submitWasherDocumentsSchema>;

/**
 * The partner's own profile.
 *
 * `verificationStatus` reuses `verificationStatusSchema` rather than being
 * `z.string()`. S-10 records the valet view shipping the wide version, which
 * leaves every consumer's `switch` falling into its default branch on a typo
 * instead of failing typecheck. Fail-closed at runtime is right; it is not a
 * reason to give up the compile-time check on top of it.
 */
export const washerProfileViewSchema = z.object({
  partnerType: washerPartnerTypeSchema,
  businessName: z.string().nullable(),
  gstin: z.string().nullable(),
  businessPhotoIds: z.array(z.string()),
  operatingHours: operatingHoursSchema.nullable(),
  /** Echoes stored data, so it stays readable for rows written before T10-S1. */
  capabilities: z.array(z.string()),
  idDocumentId: z.string().nullable(),
  verificationStatus: verificationStatusSchema,
  isOnline: z.boolean(),
  lastSeenAt: z.string().datetime().nullable(),
  ratingAvgBp: z.number().int().nullable(),
  ratingCount: z.number().int().nonnegative(),
});

export type WasherProfileView = z.infer<typeof washerProfileViewSchema>;
