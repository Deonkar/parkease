import { z } from 'zod';

import { ledgerAccountSchema } from '../enums/ledger-account.js';
import { ledgerDirectionSchema } from '../enums/ledger-direction.js';
import { bookingIdSchema, payoutIdSchema, txnIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

import { dateRangeSchema } from './finance.js';
import { adminCursorQuerySchema, istDateSchema } from './query.js';

export const ledgerQuerySchema = adminCursorQuerySchema.extend({
  account: ledgerAccountSchema.optional(),
  txnId: txnIdSchema.optional(),
  bookingId: bookingIdSchema.optional(),
  payoutId: payoutIdSchema.optional(),
  from: istDateSchema.optional(),
  to: istDateSchema.optional(),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  txnId: txnIdSchema,
  account: ledgerAccountSchema,
  direction: ledgerDirectionSchema,
  amountPaise: paiseSchema,
  bookingId: bookingIdSchema.nullable(),
  payoutId: payoutIdSchema.nullable(),
  description: z.string(),
  occurredAt: z.string().datetime(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export const ledgerExportQuerySchema = dateRangeSchema;
export type LedgerExportQuery = z.infer<typeof ledgerExportQuerySchema>;
