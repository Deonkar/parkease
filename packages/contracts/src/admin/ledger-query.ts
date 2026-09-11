import { z } from 'zod';

import { ledgerAccountSchema } from '../enums/ledger-account.js';
import { ledgerDirectionSchema } from '../enums/ledger-direction.js';
import { txnIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';
import { paiseSchema } from '../primitives/paise.js';

export const ledgerQuerySchema = paginationQuerySchema.extend({
  account: ledgerAccountSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  txnId: txnIdSchema.optional(),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  txnId: txnIdSchema,
  account: ledgerAccountSchema,
  direction: ledgerDirectionSchema,
  amountPaise: paiseSchema,
  currency: z.string().length(3),
  description: z.string(),
  occurredAt: z.string().datetime(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
