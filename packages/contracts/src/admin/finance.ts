import { z } from 'zod';

import { ledgerAccountSchema } from '../enums/ledger-account.js';
import { payoutStatusSchema } from '../enums/payout-status.js';
import { payoutIdSchema, userIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

import { adminPageQuerySchema, istDateSchema } from './query.js';

const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 86_400_000;

const istDate = istDateSchema;

/**
 * The one definition of a valid range, shared by every schema that carries a `from` and a `to`.
 * Inert unless both ends are present, so a one-sided filter stays legal where a filter is optional.
 */
export function refineDateRange(
  range: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (range.from === undefined || range.to === undefined) return;
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  // An unparseable date already carries its own issue from `.date()`.
  if (Number.isNaN(from) || Number.isNaN(to)) return;

  if (from >= to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: '`to` must be after `from`',
    });
  } else if ((to - from) / MS_PER_DAY > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: `Range cannot exceed ${String(MAX_RANGE_DAYS)} days`,
    });
  }
}

/**
 * IST calendar dates, `to` exclusive, so `2026-10-01` to `2026-10-08` is seven whole days.
 * The span is capped because every finance query is one GROUP BY over the ledger, and an
 * unbounded range is an unbounded scan on a table that only grows.
 */
export const dateRangeSchema = z
  .object({ from: istDate, to: istDate })
  .superRefine(refineDateRange);

export type DateRange = z.infer<typeof dateRangeSchema>;

export const accountBalanceSchema = z.object({
  account: ledgerAccountSchema,
  debitsPaise: paiseSchema,
  creditsPaise: paiseSchema,
  /** Absolute difference; `side` says which way it leans. */
  balancePaise: paiseSchema,
  side: z.enum(['dr', 'cr']).nullable(),
});

export type AccountBalance = z.infer<typeof accountBalanceSchema>;

export const financeBalancesSchema = z.object({
  from: istDate,
  to: istDate,
  /** All ten accounts, zero rows included, so a missing row is never mistaken for a zero. */
  accounts: z.array(accountBalanceSchema),
  totalDebitsPaise: paiseSchema,
  totalCreditsPaise: paiseSchema,
  balanced: z.boolean(),
});

export type FinanceBalances = z.infer<typeof financeBalancesSchema>;

/** The exact slice of the ledger a dashboard card was computed from, for "Show queries". */
export const kpiQuerySchema = z.object({
  account: ledgerAccountSchema,
  side: z.enum(['debit', 'credit', 'net_credit']),
  from: istDate,
  to: istDate,
});

export type KpiQuery = z.infer<typeof kpiQuerySchema>;

export const dashboardSchema = z.object({
  from: istDate,
  to: istDate,
  grossPaise: paiseSchema,
  platformRevenuePaise: paiseSchema,
  ownerPayablePaise: paiseSchema,
  gstPayablePaise: paiseSchema,
  queries: z.object({
    gross: kpiQuerySchema,
    platformRevenue: kpiQuerySchema,
    ownerPayable: kpiQuerySchema,
    gstPayable: kpiQuerySchema,
  }),
  bookings: z.number().int().nonnegative(),
  activeSpaces: z.number().int().nonnegative(),
  pending: z.object({
    spaces: z.number().int().nonnegative(),
    partners: z.number().int().nonnegative(),
    reports: z.number().int().nonnegative(),
  }),
  ledger: z.object({
    balanced: z.boolean(),
    imbalancedTxnIds: z.array(z.string().uuid()),
  }),
  /** Gross bookings per IST day across the range, for the dashboard chart. */
  series: z.array(z.object({ day: istDate, grossPaise: paiseSchema })),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

export const payoutsQuerySchema = adminPageQuerySchema.extend({
  status: payoutStatusSchema.optional(),
  userId: userIdSchema.optional(),
});

export type PayoutsQuery = z.infer<typeof payoutsQuerySchema>;

export const adminPayoutSchema = z.object({
  id: payoutIdSchema,
  userId: userIdSchema,
  /** ISO week in IST, `2026-W40`. */
  period: z.string().regex(/^\d{4}-W\d{2}$/),
  grossPaise: paiseSchema,
  netPaise: paiseSchema,
  status: payoutStatusSchema,
  razorpayPayoutId: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type AdminPayout = z.infer<typeof adminPayoutSchema>;

export const reconciliationQuerySchema = dateRangeSchema;
export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>;

/** Either side can be absent: a payment we never recorded, or one the gateway never saw. */
export const reconciliationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  reference: z.string(),
  expectedPaise: paiseSchema.nullable(),
  actualPaise: paiseSchema.nullable(),
  detail: z.string(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type ReconciliationItem = z.infer<typeof reconciliationItemSchema>;
