import {
  type BankDetailsView,
  bankDetailsViewSchema,
  type PayoutView,
  payoutViewSchema,
} from '@parkease/contracts/shared';

import type { BankDetailsRow, PayoutRow } from '../../../domains/payout/payout.service.js';
import { parseOutgoing } from '../../../platform/http/outgoing-contract.js';

/** The masked view is built from the masked columns only; the ciphertext never gets here. */
export const toBankDetailsView = (row: BankDetailsRow): BankDetailsView =>
  parseOutgoing(
    bankDetailsViewSchema,
    {
      accountHolderName: row.accountHolderName,
      accountNumberLast4: row.last4,
      ifscPrefix: row.ifscPrefix,
      updatedAt: row.updatedAt.toISOString(),
      payoutsHeldUntil:
        row.payoutsHeldUntil !== null && row.payoutsHeldUntil > new Date()
          ? row.payoutsHeldUntil.toISOString()
          : null,
    },
    'bank details view',
  );

export const toPayoutView = (row: PayoutRow): PayoutView =>
  parseOutgoing(
    payoutViewSchema,
    {
      id: row.id,
      period: row.period,
      grossPaise: row.grossPaise,
      tcsPaise: row.tcsPaise,
      tdsPaise: row.tdsPaise,
      netPaise: row.netPaise,
      status: row.status,
      razorpayPayoutId: row.razorpayPayoutId,
      createdAt: row.createdAt.toISOString(),
    },
    'payout view',
  );
