import { settlementClearedEntries } from '@parkease/contracts/money';
import { payouts } from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';
import { parsePaymentJobPayload } from '../payment/payload.js';

import { failPayout } from './fail.js';
import { applyPayoutStatusPayloadSchema, PAYOUT_APPLY_STATUS_JOB } from './payload.js';

/** RazorpayX statuses that mean the money did not, or no longer did, reach the payee. */
export const PAYOUT_FAILED_STATUSES = new Set(['reversed', 'failed', 'rejected', 'cancelled']);

/**
 * One payout status, wherever it was learned: the webhook (S-102) or the daily reconcile's poll.
 * Both apply it here, so a pushed event and a polled one can never disagree about what it means.
 *
 * - `processed` on a `processing` payout: paid, and its transit leg cleared.
 * - a failed status on one in flight: failed, owed again.
 * - `reversed` on a `paid` payout: the bank returned it. Failed, owed again, and flagged.
 * Anything else (`queued`, `pending`, a stale `processed` after a reversal) changes nothing. Each
 * write is guarded on the status it moves from, so redelivery and the poll racing it are no-ops.
 */
export async function applyPayoutStatus(
  deps: JobDeps,
  payoutId: string,
  status: string,
): Promise<void> {
  if (PAYOUT_FAILED_STATUSES.has(status)) {
    const [row] = await deps.db
      .select({ status: payouts.status })
      .from(payouts)
      .where(eq(payouts.id, payoutId));
    if (row?.status === 'paid') {
      // Only a reversal can undo a paid payout; a late `failed` for one we saw processed is drift.
      if (status === 'reversed') {
        await failPayout(deps, payoutId, `razorpayx ${status}`, { reversedAfterPaid: true });
      }
      return;
    }
    await failPayout(deps, payoutId, `razorpayx ${status}`);
    return;
  }
  if (status !== 'processed') return;

  await deps.db.transaction(async (tx) => {
    const [paid] = await tx
      .update(payouts)
      .set({ status: 'paid', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'processing')))
      .returning({ netPaise: payouts.netPaise });
    if (paid === undefined) return;
    await postLedger(tx, { payoutId, entries: settlementClearedEntries(paid.netPaise) });
  });
}

/** The `payout.apply-status` job: a webhook event, matched to our payout by RazorpayX's id. */
export async function applyPayoutStatusJob(deps: JobDeps, raw: unknown): Promise<void> {
  const { razorpayPayoutId, status } = parsePaymentJobPayload(
    applyPayoutStatusPayloadSchema,
    raw,
    PAYOUT_APPLY_STATUS_JOB,
  );
  const [payout] = await deps.db
    .select({ id: payouts.id })
    .from(payouts)
    .where(eq(payouts.razorpayPayoutId, razorpayPayoutId));
  if (payout === undefined) {
    // The event can outrun `payout.send` writing the id down. Throwing retries it; the reconcile
    // poll is the safety net if it never matches.
    throw new Error(`${PAYOUT_APPLY_STATUS_JOB}: no payout carries ${razorpayPayoutId} yet`);
  }
  await applyPayoutStatus(deps, payout.id, status);
  logger.info({ payoutId: payout.id, status }, `${PAYOUT_APPLY_STATUS_JOB}: applied`);
}
