import { z } from 'zod';

import { carwashJobStatusSchema } from '../enums/carwash-job-status.js';
import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, washJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

/** The one live job a partner is on. */
export const washJobViewSchema = z.object({
  id: washJobIdSchema,
  bookingId: bookingIdSchema,
  status: carwashJobStatusSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  spaceLocation: geoPointSchema,
  /** The partner's take-home, frozen at accept. Null until somebody accepts. */
  earningsPaise: paiseSchema.nullable(),
  /** Which events the machine will accept next, so the app renders one button. */
  availableEvents: z.array(z.string()),
  beforePhotoId: z.string().nullable(),
  afterPhotoId: z.string().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export type WashJobView = z.infer<typeof washJobViewSchema>;

/**
 * Ledger-derived, gross and net.
 *
 * Three numbers rather than two, because gross and net differ for a reason a
 * partner is owed an explanation of: a job cancelled after they accepted claws
 * the credited amount back, and a screen showing only the net leaves them
 * unable to see that a reversal happened at all.
 *
 * There is deliberately no `commissionPaise`. Commission is credited to
 * `platform_revenue`, not to this account, so reporting it here would mean
 * either a second query or quietly relabelling the clawback total as
 * commission — and a wrong label on a money screen is worse than an absent one.
 */
export const washerEarningsSummarySchema = z.object({
  /** Credits to this partner across every job, before any reversal. */
  grossPaise: paiseSchema,
  /** Debits: what a cancellation clawed back. */
  reversedPaise: paiseSchema,
  /** What the ledger says we owe this partner right now. */
  netPaise: paiseSchema,
  jobsCompleted: z.number().int().nonnegative(),
});

export type WasherEarningsSummary = z.infer<typeof washerEarningsSummarySchema>;

export const WASHER_EARNINGS_PERIOD_VALUES = ['today', 'week', 'month', 'all'] as const;
export const washerEarningsPeriodSchema = z.enum(WASHER_EARNINGS_PERIOD_VALUES);
export type WasherEarningsPeriod = z.infer<typeof washerEarningsPeriodSchema>;

/** `?period=` on `GET /washer/earnings`. A partner is paid weekly, so week is the default. */
export const washerEarningsQuerySchema = z.object({
  period: washerEarningsPeriodSchema.default('week'),
});

/**
 * One completed job, as the earnings screen lists it.
 *
 * Three amounts and no rule tying them together. `netPaise` is what the ledger
 * credited this partner, `feePaise` is what it credited `platform_revenue` on
 * the same transaction, and `grossPaise` is the price frozen on the job at
 * accept (R-MONEY-03). A clawback or a correction can make them disagree with
 * the obvious subtraction, and when they do, the books are right.
 *
 * This is where the account-level refusal to report commission
 * (`washerEarningsSummarySchema`, below) does NOT apply: an aggregate over one
 * account genuinely cannot name a commission total without relabelling
 * something, but a single job has exactly one commission entry to point at.
 */
export const washerEarningsLineSchema = z.object({
  jobId: washJobIdSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  completedAt: z.string().datetime(),
  /** The driver-facing service price, frozen on the job at accept. */
  grossPaise: paiseSchema,
  /** Credited to `platform_revenue` on this job's transaction. Read, never subtracted. */
  feePaise: paiseSchema,
  /** Credited to this partner. */
  netPaise: paiseSchema,
});

export type WasherEarningsLine = z.infer<typeof washerEarningsLineSchema>;

export const washerEarningsViewSchema = z.object({
  period: washerEarningsPeriodSchema,
  summary: washerEarningsSummarySchema,
  lines: z.array(washerEarningsLineSchema),
});

export type WasherEarningsView = z.infer<typeof washerEarningsViewSchema>;
