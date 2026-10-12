import { draftsFromLedgerRows, reverseEntries } from '@parkease/contracts/money';
import {
  ledgerEntries,
  outboxMessages,
  payouts,
  reconciliationMismatches,
} from '@parkease/db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

/**
 * A payout that will not arrive: mark it failed, reverse its posting so the
 * payee is owed the money again, and tell them (website.md §5). One
 * transaction, guarded on the status, so a second caller does nothing.
 *
 * A payout already `paid` can still come back: RazorpayX reports `reversed` when the bank returns
 * it (S-102). Its clearing is reversed with its posting, so the ledger says the money never left,
 * and a `payout_failed` mismatch is raised, because money we told the payee had arrived did not.
 */
export async function failPayout(
  deps: JobDeps,
  payoutId: string,
  reason: string,
  /** Only a bank reversal reported by RazorpayX may undo a paid payout; every other caller may not. */
  opts: { readonly reversedAfterPaid?: boolean } = {},
): Promise<void> {
  const from = opts.reversedAfterPaid === true ? ['paid'] : ['pending', 'processing'];
  await deps.db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: payouts.status })
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .for('update');
    const [payout] = await tx
      .update(payouts)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), inArray(payouts.status, from)))
      .returning();
    if (payout === undefined || before === undefined) return;

    // Everything posted against the payout: its posting and, once paid, its clearing.
    const rows = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, payoutId));
    await postLedger(tx, {
      payoutId,
      entries: reverseEntries(draftsFromLedgerRows(rows), `payout failed: ${reason}`),
    });

    if (before.status === 'paid') {
      await tx
        .insert(reconciliationMismatches)
        .values({
          kind: 'payout_failed',
          reference: payoutId,
          expectedPaise: payout.netPaise,
          actualPaise: 0,
          detail: `reported paid, then ${reason}: the bank returned it`,
        })
        .onConflictDoNothing({
          target: [reconciliationMismatches.kind, reconciliationMismatches.reference],
          where: isNull(reconciliationMismatches.resolvedAt),
        });
    }

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: payout.userId,
        template: 'payout.failed',
        data: { payoutId, netPaise: payout.netPaise, period: payout.period },
      },
    });

    logger.warn(
      { payoutId, userId: payout.userId, reason, was: before.status },
      'payout failed; balance owed again',
    );
  });
}
