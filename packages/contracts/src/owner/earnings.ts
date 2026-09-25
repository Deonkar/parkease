import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseDeltaSchema, paiseSchema } from '../primitives/paise.js';

export const OWNER_EARNINGS_PERIOD_VALUES = ['today', 'week', 'month'] as const;
export const ownerEarningsPeriodSchema = z.enum(OWNER_EARNINGS_PERIOD_VALUES);
export type OwnerEarningsPeriod = z.infer<typeof ownerEarningsPeriodSchema>;

/** `?period=` on `GET /owner/earnings`. Month is the owner's natural unit. */
export const ownerEarningsQuerySchema = z.object({
  period: ownerEarningsPeriodSchema.default('month'),
});

export const ownerTransactionsQuerySchema = paginationQuerySchema.extend({
  period: ownerEarningsPeriodSchema.default('month'),
});

/**
 * One booking on the owner's statement (spec §3). Base and fee are what
 * pricing recorded and what the ledger credited; `netPaise` is the ledger's
 * credits minus debits for the booking. Strict, so a surge, GST or driver
 * total can never ride along (ADR-009).
 */
export const statementLineSchema = z
  .object({
    bookingId: bookingIdSchema,
    occurredAt: z.string().datetime(),
    driverName: z.string(),
    spaceName: z.string(),
    durationLabel: z.string(),
    basePaise: paiseSchema,
    feePaise: paiseSchema,
    reversedPaise: paiseSchema,
    netPaise: paiseDeltaSchema,
  })
  .strict();
export type StatementLine = z.infer<typeof statementLineSchema>;

/**
 * Ledger movement on the owner's `owner_payable` in the period, by posting
 * time. A bounded period's net can be negative: a refund posted this week
 * against a booking credited last week.
 */
export const ownerEarningsViewSchema = z
  .object({
    period: ownerEarningsPeriodSchema,
    netPaise: paiseDeltaSchema,
    grossPaise: paiseSchema,
    reversedPaise: paiseSchema,
    bookings: z.number().int().nonnegative(),
    days: z.array(
      z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), netPaise: paiseDeltaSchema }),
    ),
  })
  .strict();
export type OwnerEarningsView = z.infer<typeof ownerEarningsViewSchema>;
