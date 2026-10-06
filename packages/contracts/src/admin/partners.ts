import { z } from 'zod';

import { verificationStatusSchema } from '../enums/verification-status.js';
import { userIdSchema } from '../primitives/ids.js';

import { adminPageQuerySchema } from './query.js';

export const PARTNER_KIND_VALUES = ['valet', 'washer'] as const;

export const partnerKindSchema = z.enum(PARTNER_KIND_VALUES);
export type PartnerKind = z.infer<typeof partnerKindSchema>;

export const adminPartnersQuerySchema = adminPageQuerySchema.extend({
  kind: partnerKindSchema.optional(),
  status: verificationStatusSchema.default('pending'),
});

export type AdminPartnersQuery = z.infer<typeof adminPartnersQuerySchema>;

export const adminPartnerSchema = z.object({
  userId: userIdSchema,
  kind: partnerKindSchema,
  name: z.string().nullable(),
  displayName: z.string().nullable(),
  /** `maskPhone` output. */
  phone: z.string(),
  verificationStatus: verificationStatusSchema,
  requestedAt: z.string().datetime(),
});

export type AdminPartner = z.infer<typeof adminPartnerSchema>;

export const partnerDocumentSchema = z.object({
  kind: z.enum(['driving_licence', 'id_proof', 'business_photo']),
  /**
   * An ID document or licence is a short-lived signed URL: documents are never served from a public
   * path. A business photo is a public image (it is shown to drivers) and has an ordinary URL.
   */
  url: z.string().url(),
  /** When the link stops working; `null` for a public business photo, whose link does not expire. */
  expiresAt: z.string().datetime().nullable(),
});

export type PartnerDocument = z.infer<typeof partnerDocumentSchema>;

export const adminPartnerDetailSchema = adminPartnerSchema.extend({
  vehicleNumber: z.string().nullable(),
  operatingHours: z.unknown().nullable(),
  documents: z.array(partnerDocumentSchema),
});

export type AdminPartnerDetail = z.infer<typeof adminPartnerDetailSchema>;

/** A person can be both a valet and a washer, so a decision names which profile it is about. */
export const partnerDecisionSchema = z.object({ kind: partnerKindSchema });
export type PartnerDecision = z.infer<typeof partnerDecisionSchema>;

export const partnerRejectSchema = z.object({
  kind: partnerKindSchema,
  notes: z.string().trim().min(1).max(1000),
});

export type PartnerReject = z.infer<typeof partnerRejectSchema>;
