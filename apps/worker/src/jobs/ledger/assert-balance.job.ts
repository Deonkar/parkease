import { sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

/**
 * Every `txn_id` posted in the last day must have equal debits and credits (ADR-008).
 *
 * Each side is coalesced to 0. A `sum(...) FILTER` over no rows is NULL, and `NULL <> x` is NULL
 * rather than true, so without it a posting with one side missing entirely — the lost leg, the
 * likeliest real imbalance — would never be reported. `imbalancedTxnIds` on the admin finance
 * screen and `ledger-balance.spec.ts` compare the same way.
 */
export async function assertLedgerBalance(deps: JobDeps): Promise<string[]> {
  const imbalanced = await deps.db.execute<{ txn_id: string }>(sql`
    SELECT txn_id
    FROM ledger_entries
    WHERE occurred_at > now() - interval '1 day'
    GROUP BY txn_id
    HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
        <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
  `);

  const txnIds = imbalanced.map((r) => r.txn_id);
  if (txnIds.length > 0) {
    logger.fatal({ txnIds }, 'LEDGER_IMBALANCE');
  }
  return txnIds;
}
