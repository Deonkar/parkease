import { LedgerAccount } from '@parkease/contracts/enums';
import { settlementClearedEntries } from '@parkease/contracts/money';
import { ledgerEntries, payments, payouts, reconciliationMismatches } from '@parkease/db/schema';
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';
import { razorpayTransfers, type TransferGateway } from '../payment/razorpay.js';

import { failPayout } from './fail.js';
import { PAYOUT_RECONCILE_JOB } from './payload.js';
import { istStartOfDay } from './period.js';
import { type PayoutGateway, razorpayxPayouts } from './razorpayx.js';

/**
 * Daily 02:00 IST (§16.7): confirm that money we recorded as leaving actually
 * left, and say so loudly when it did not.
 *
 * - **Route.** Every capture before today whose transfer is not yet cleared:
 *   Razorpay's processed transfers must sum to exactly `route_transfer_paise`.
 *   A match clears `settlement_clearing`; a difference or no transfer at all is
 *   a mismatch row; a transfer still `created`/`pending` waits for tomorrow.
 * - **RazorpayX.** Every payout in flight: `processed` → paid and cleared;
 *   `reversed`/`failed`/`rejected`/`cancelled` → failed, owed again. A claim
 *   that never reached RazorpayX in a day is a mismatch.
 *
 * Idempotent (R-ASYNC-03): clearings are guarded on a row lock and an existing
 * clearing, mismatches on `unique(kind, reference)`. A lookup that fails is
 * logged and the rest carry on; the run then throws so pg-boss retries it.
 *
 * ponytail: one Razorpay call per unreconciled capture. Switch to
 * `transfers.all({ from, to })` when daily volume makes that slow.
 */
const BATCH = 500;
const DAY_MS = 86_400_000;
const STUCK_AFTER_MS = DAY_MS;
/** A Route transfer still unprocessed this long after capture is a mismatch, not a wait. */
const TRANSFER_OVERDUE_MS = 3 * DAY_MS;
const PAYOUT_FAILED_STATUSES = new Set(['reversed', 'failed', 'rejected', 'cancelled']);

export async function reconcilePayouts(
  deps: JobDeps,
  opts: { transfers: TransferGateway; payouts: PayoutGateway; now: Date } = {
    transfers: razorpayTransfers,
    payouts: razorpayxPayouts,
    now: new Date(),
  },
): Promise<void> {
  let failures = 0;
  const attempt = async (what: Record<string, string>, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      failures += 1;
      logger.warn({ ...what, err: error }, `${PAYOUT_RECONCILE_JOB}: lookup failed, will retry`);
    }
  };

  for (const payment of await unclearedCaptures(deps, istStartOfDay(opts.now))) {
    await attempt({ paymentId: payment.id }, () =>
      reconcileTransfer(deps, opts.transfers, payment, opts.now),
    );
  }

  const inFlight = await deps.db
    .select({ id: payouts.id, razorpayPayoutId: payouts.razorpayPayoutId })
    .from(payouts)
    .where(and(eq(payouts.status, 'processing'), isNotNull(payouts.razorpayPayoutId)));
  for (const payout of inFlight) {
    await attempt({ payoutId: payout.id }, () =>
      reconcilePayout(deps, opts.payouts, payout.id, payout.razorpayPayoutId ?? ''),
    );
  }

  const stuck = await deps.db
    .select({ id: payouts.id, netPaise: payouts.netPaise })
    .from(payouts)
    .where(
      and(
        eq(payouts.status, 'processing'),
        isNull(payouts.razorpayPayoutId),
        lt(payouts.initiatedAt, new Date(opts.now.getTime() - STUCK_AFTER_MS)),
      ),
    );
  for (const payout of stuck) {
    await flag(deps, {
      kind: 'payout_failed',
      reference: payout.id,
      expectedPaise: payout.netPaise,
      actualPaise: null,
      detail: 'claimed for sending a day ago and never reached RazorpayX',
    });
  }

  const open = await deps.db
    .select({ kind: reconciliationMismatches.kind, reference: reconciliationMismatches.reference })
    .from(reconciliationMismatches)
    .where(isNull(reconciliationMismatches.resolvedAt))
    .orderBy(asc(reconciliationMismatches.createdAt));
  if (open.length > 0) {
    // Pages (security.md §8.4): money moved differently than the ledger says.
    // The oldest few are named, so the page says where to look.
    logger.error(
      { unresolved: open.length, oldest: open.slice(0, 10) },
      'reconciliation mismatches unresolved',
    );
  }

  if (failures > 0) {
    throw new Error(`${PAYOUT_RECONCILE_JOB}: ${String(failures)} lookup(s) failed`);
  }
}

interface UnclearedCapture {
  readonly id: string;
  readonly razorpayPaymentId: string | null;
  readonly expectedPaise: number | null;
  readonly capturedAt: Date | null;
}

const clearingExists = sql`exists (select 1 from ledger_entries c
  where c.payment_id = ${payments}.${sql.identifier(payments.id.name)}
    and c.account = ${LedgerAccount.SETTLEMENT_CLEARING} and c.direction = 'debit')`;

/** Already flagged and not yet resolved: asking Razorpay again changes nothing. */
const openMismatch = sql`exists (select 1 from reconciliation_mismatches m
  where m.reference = ${payments}.${sql.identifier(payments.id.name)}::text
    and m.resolved_at is null)`;

async function unclearedCaptures(deps: JobDeps, before: Date): Promise<UnclearedCapture[]> {
  return (
    deps.db
      .select({
        id: payments.id,
        razorpayPaymentId: payments.razorpayPaymentId,
        expectedPaise: payments.routeTransferPaise,
        capturedAt: payments.capturedAt,
      })
      .from(payments)
      .where(
        and(
          isNotNull(payments.routeTransferPaise),
          isNotNull(payments.razorpayPaymentId),
          lt(payments.capturedAt, before),
          sql`not ${clearingExists}`,
          sql`not ${openMismatch}`,
        ),
      )
      // Oldest first, so a backlog drains in order and never starves new captures.
      .orderBy(asc(payments.capturedAt))
      .limit(BATCH)
  );
}

async function reconcileTransfer(
  deps: JobDeps,
  gateway: TransferGateway,
  payment: UnclearedCapture,
  now: Date,
): Promise<void> {
  const expectedPaise = payment.expectedPaise ?? 0;
  const found = await gateway.forPayment(payment.razorpayPaymentId ?? '');
  if (found.some((t) => t.status === 'created' || t.status === 'pending')) {
    const age = now.getTime() - (payment.capturedAt?.getTime() ?? now.getTime());
    if (age < TRANSFER_OVERDUE_MS) return; // Razorpay has not got to it yet
    await flag(deps, {
      kind: 'missing_transfer',
      reference: payment.id,
      expectedPaise,
      actualPaise: 0,
      detail: 'Route transfer still unprocessed three days after capture',
    });
    return;
  }

  const processedPaise = found
    .filter((t) => t.status === 'processed')
    .reduce((sum, t) => sum + t.amountPaise, 0);

  if (found.length === 0 || processedPaise !== expectedPaise) {
    await flag(deps, {
      kind: found.length === 0 ? 'missing_transfer' : 'amount_mismatch',
      reference: payment.id,
      expectedPaise,
      actualPaise: processedPaise,
      detail:
        found.length === 0
          ? 'captured with a Route transfer attached, and Razorpay reports none'
          : 'Route transferred a different amount than the ledger discharged',
    });
    return;
  }

  await deps.db.transaction(async (tx) => {
    // The row lock serialises two runs; the re-check makes the loser a no-op.
    await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.id, payment.id))
      // NO KEY UPDATE: serialises two reconcile runs without blocking the
      // FOR KEY SHARE every FK insert referencing this payment takes.
      .for('no key update');
    const [already] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.paymentId, payment.id),
          eq(ledgerEntries.account, LedgerAccount.SETTLEMENT_CLEARING),
          eq(ledgerEntries.direction, 'debit'),
        ),
      );
    if (already !== undefined) return;
    await postLedger(tx, {
      paymentId: payment.id,
      entries: settlementClearedEntries(expectedPaise),
    });
  });
}

async function reconcilePayout(
  deps: JobDeps,
  gateway: PayoutGateway,
  payoutId: string,
  razorpayPayoutId: string,
): Promise<void> {
  const sent = await gateway.fetch(razorpayPayoutId);

  if (PAYOUT_FAILED_STATUSES.has(sent.status)) {
    await failPayout(deps, payoutId, `razorpayx ${sent.status}`);
    return;
  }
  if (sent.status !== 'processed') return; // queued / pending / processing: tomorrow

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

async function flag(
  deps: JobDeps,
  mismatch: {
    kind: 'amount_mismatch' | 'missing_transfer' | 'payout_failed';
    reference: string;
    expectedPaise: number | null;
    actualPaise: number | null;
    detail: string;
  },
): Promise<void> {
  await deps.db
    .insert(reconciliationMismatches)
    .values(mismatch)
    .onConflictDoNothing({
      target: [reconciliationMismatches.kind, reconciliationMismatches.reference],
      // The key covers unresolved rows only (0033), so the arbiter must say so.
      where: isNull(reconciliationMismatches.resolvedAt),
    });
}
