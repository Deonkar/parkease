import { z } from 'zod';

import { carwashJobStatusSchema } from '../enums/carwash-job-status.js';
import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, washJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseDeltaSchema, paiseSchema } from '../primitives/paise.js';

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
 *
 * All three amounts are `owner_payable` movement for this partner, bounded by
 * posting time (`ledger_entries.occurred_at`) — the credit posts at accept, a
 * cancellation's reversal posts at cancel. For `all` that is the partner's
 * whole history; for a bounded period it is only what posted inside it.
 */
export const washerEarningsSummarySchema = z.object({
  /**
   * Credits to this partner posted in the period, before any reversal. For
   * `all`, every credit this partner has ever had.
   */
  grossPaise: paiseSchema,
  /**
   * Debits posted in the period: what cancellations clawed back. A reversal
   * counts in the period it posted, which need not be the period of the credit
   * it reverses.
   */
  reversedPaise: paiseSchema,
  /**
   * Credits minus debits posted in the period — movement, not a balance, so it
   * is SIGNED. A job accepted Sunday 23:55 IST and cancelled Monday 00:05
   * leaves this week with a reversal and no credit, and the week's net is
   * honestly negative. Only for `all` is this what the ledger says we owe this
   * partner right now, and there it cannot go below zero.
   */
  netPaise: paiseDeltaSchema,
  /** Jobs completed in the period, by `wash_jobs.completed_at` — see `washerEarningsViewSchema`. */
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
 * (`washerEarningsSummarySchema`, above) does NOT apply: an aggregate over one
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

/**
 * `GET /washer/earnings` for one period.
 *
 * The summary and the lines count by DIFFERENT instants, deliberately, and the
 * two need not sum:
 *
 * - `summary` amounts are ledger movement by posting time
 *   (`ledger_entries.occurred_at`): a job's credit lands in the period it was
 *   ACCEPTED, its reversal in the period it was CANCELLED. This is how the
 *   task file's own §14.6 demo SQL defines the weekly figure: `owner_payable`
 *   movement bounded by `occurred_at`.
 * - `lines` and `summary.jobsCompleted` are jobs COMPLETED in the period, by
 *   `wash_jobs.completed_at`.
 *
 * So a job accepted this week but still `washing` is in this week's
 * `summary.netPaise` with no line, and a job accepted last week and completed
 * this week has a line this week while its money sits in last week's summary.
 * A client must not reconcile one against the other.
 */
export const washerEarningsViewSchema = z.object({
  period: washerEarningsPeriodSchema,
  summary: washerEarningsSummarySchema,
  lines: z.array(washerEarningsLineSchema),
});

export type WasherEarningsView = z.infer<typeof washerEarningsViewSchema>;
