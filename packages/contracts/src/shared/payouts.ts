import { z } from 'zod';

import { payoutStatusSchema } from '../enums/payout-status.js';
import { payoutIdSchema } from '../primitives/ids.js';
import { cursorPageOf } from '../primitives/pagination.js';
import { paiseDeltaSchema, paiseSchema } from '../primitives/paise.js';

/**
 * `PUT /me/bank-details`. Shared across owner, valet and washer: valets are who
 * RazorpayX actually pays (ADR-030), so an owner-only route would lock out the
 * people it exists for.
 *
 * Indian account numbers are 9–18 digits. The IFSC is four letters, a zero,
 * and six alphanumerics; RazorpayX re-validates both when the fund account is
 * created, and rejects to the user on save rather than on Monday.
 */
export const updateBankDetailsSchema = z
  .object({
    accountHolderName: z.string().trim().min(1).max(120),
    accountNumber: z.string().regex(/^\d{9,18}$/, 'Enter a valid account number'),
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code'),
    /**
     * A Firebase ID token from a phone OTP the user has just completed (S-100). Where money is
     * paid is changed only by someone holding the phone right now, not by any live session: a
     * stolen session alone cannot redirect a payout.
     */
    reauthToken: z.string().min(1).max(4096),
  })
  .strict();

export type UpdateBankDetails = z.infer<typeof updateBankDetailsSchema>;

/** Masked, always. No response ever carries a full account number (R-SEC-05). */
export const bankDetailsViewSchema = z.object({
  accountHolderName: z.string(),
  accountNumberLast4: z.string().regex(/^\d{4}$/),
  ifscPrefix: z.string().regex(/^[A-Z]{4}$/),
  updatedAt: z.string().datetime(),
  /**
   * Payouts to these details wait until this time after a change (S-100); null when nothing is
   * held. The screen says when the first payout to the new account can go.
   */
  payoutsHeldUntil: z.string().datetime().nullable(),
});

export type BankDetailsView = z.infer<typeof bankDetailsViewSchema>;

export const payoutViewSchema = z.object({
  id: payoutIdSchema,
  /** ISO week in IST, `2026-W40`. */
  period: z.string().regex(/^\d{4}-W\d{2}$/),
  grossPaise: paiseSchema,
  tcsPaise: paiseSchema,
  tdsPaise: paiseSchema,
  netPaise: paiseSchema,
  status: payoutStatusSchema,
  /** RazorpayX's `pout_…` reference, once the payout has been sent. */
  razorpayPayoutId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type PayoutView = z.infer<typeof payoutViewSchema>;

/**
 * Keyset on the payout id. Ids are UUIDv7, so id order is creation order and
 * the cursor is simply the last id — no codec to forge or to drift (S-87).
 */
export const payoutListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: payoutIdSchema.optional(),
});

export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

export const payoutPageSchema = cursorPageOf(payoutViewSchema);

/**
 * `GET /me/payouts/summary` (valet; task 16b). What the next Monday run will pay if it is
 * `minimumPaise` or more. Signed: a reversal after a payout can leave it negative.
 */
export const payoutSummaryViewSchema = z.object({
  balancePaise: paiseDeltaSchema,
  /** IST date of the next run, `YYYY-MM-DD`, from the shared payout schedule. */
  nextPayoutOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minimumPaise: paiseSchema,
});

export type PayoutSummaryView = z.infer<typeof payoutSummaryViewSchema>;
