import { sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

export async function assertLedgerBalance(deps: JobDeps): Promise<void> {
  const imbalanced = await deps.db.execute<{ txn_id: string }>(sql`
    SELECT txn_id,
           sum(amount_paise) FILTER (WHERE direction = 'debit')  AS debits,
           sum(amount_paise) FILTER (WHERE direction = 'credit') AS credits
    FROM ledger_entries
    WHERE occurred_at > now() - interval '1 day'
    GROUP BY txn_id
    HAVING sum(amount_paise) FILTER (WHERE direction = 'debit')
        <> sum(amount_paise) FILTER (WHERE direction = 'credit')
  `);

  if (imbalanced.length > 0) {
    logger.fatal({ txnIds: imbalanced.map((r) => r.txn_id) }, 'LEDGER_IMBALANCE');
  }
}
