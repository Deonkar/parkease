import { payoutEntries } from '@parkease/contracts/money';
import { toPaise } from '@parkease/contracts/primitives';
import { uuidv7 } from '@parkease/db/id';
import { bankDetails, bookings, ledgerEntries, outboxMessages, payouts } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import { env } from '../../config/env.js';
import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

import { PAYABLE_BALANCE, partnerPayable } from './payable.js';
import { MINIMUM_PAYOUT_PAISE, PAYOUT_SEND_JOB } from './payload.js';
import { payoutPeriod } from './period.js';

/**
 * Monday 06:00 IST (§16.6): everyone RazorpayX pays gets their whole payable
 * balance, less TCS/TDS at the rates in force, in one payout for the week.
 *
 * The balance, not the week's earnings: a missed week must not lose money.
 * Each payee is its own transaction — the payout row, its ledger posting and
 * the `payout.send` message commit together, and one payee's failure leaves
 * the rest untouched. `payouts_user_id_period_key` makes a second run in the
 * same week (a redelivery, a manual re-run) insert nothing (R-ASYNC-03).
 *
 * The gateway call is not here: it is `payout.send`, off the outbox, outside
 * any transaction (rule 4).
 */
export async function runWeeklyPayouts(
  deps: JobDeps,
  opts: { accountNumber: string | undefined; now: Date } = {
    accountNumber: env.RAZORPAYX_ACCOUNT_NUMBER,
    now: new Date(),
  },
): Promise<void> {
  if (opts.accountNumber === undefined) {
    logger.warn('payout.run-weekly: RAZORPAYX_ACCOUNT_NUMBER is not set, paying nobody');
    return;
  }
  const period = payoutPeriod(opts.now);

  const candidates = await deps.db
    .select({ userId: ledgerEntries.counterpartyUserId })
    .from(ledgerEntries)
    .leftJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
    .where(partnerPayable())
    .groupBy(ledgerEntries.counterpartyUserId)
    .having(sql`${PAYABLE_BALANCE}::bigint >= ${MINIMUM_PAYOUT_PAISE}`);

  for (const { userId } of candidates) {
    if (userId === null) continue;
    await deps.db.transaction(async (tx) => {
      const [bank] = await tx
        .select({ fundAccountId: bankDetails.razorpayxFundAccountId })
        .from(bankDetails)
        .where(eq(bankDetails.userId, userId));
      if (bank?.fundAccountId == null) {
        logger.warn({ userId, period }, 'payout skipped: no bank details on file');
        return;
      }

      // Re-read inside the transaction: the candidate list is a snapshot, and
      // paying more than is owed right now would be paying money we do not owe.
      const [row] = await tx
        .select({ balance: PAYABLE_BALANCE })
        .from(ledgerEntries)
        .leftJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
        .where(partnerPayable(userId));
      const balancePaise = Number(row?.balance ?? 0);
      if (balancePaise < MINIMUM_PAYOUT_PAISE) return;

      const posting = payoutEntries(toPaise(balancePaise), userId, opts.now);
      const txnId = uuidv7();
      const [payout] = await tx
        .insert(payouts)
        .values({
          userId,
          period,
          grossPaise: balancePaise,
          tcsPaise: posting.tcsPaise,
          tdsPaise: posting.tdsPaise,
          netPaise: posting.netPaise,
          txnId,
          status: 'pending',
        })
        .onConflictDoNothing({ target: [payouts.userId, payouts.period] })
        .returning({ id: payouts.id });
      if (payout === undefined) return; // already paid this week

      await postLedger(tx, { txnId, payoutId: payout.id, entries: posting.entries });
      await tx.insert(outboxMessages).values({
        type: PAYOUT_SEND_JOB,
        payload: { payoutId: payout.id },
      });
    });
  }
}
