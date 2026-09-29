import { draftsFromLedgerRows, reverseEntries } from '@parkease/contracts/money';
import { ledgerEntries, outboxMessages, payouts } from '@parkease/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

/**
 * A payout that will not arrive: mark it failed, reverse its posting so the
 * payee is owed the money again, and tell them (website.md §5). One
 * transaction, guarded on the status, so a second caller does nothing.
 */
export async function failPayout(deps: JobDeps, payoutId: string, reason: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [payout] = await tx
      .update(payouts)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), inArray(payouts.status, ['pending', 'processing'])))
      .returning();
    if (payout === undefined) return;

    const rows = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, payout.txnId));
    await postLedger(tx, {
      payoutId,
      entries: reverseEntries(draftsFromLedgerRows(rows), `payout failed: ${reason}`),
    });

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: payout.userId,
        template: 'payout.failed',
        data: { payoutId, netPaise: payout.netPaise, period: payout.period },
      },
    });

    logger.warn({ payoutId, userId: payout.userId, reason }, 'payout failed; balance owed again');
  });
}
