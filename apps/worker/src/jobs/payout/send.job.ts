import { bankDetails, payouts } from '@parkease/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import { env } from '../../config/env.js';
import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { parsePaymentJobPayload } from '../payment/payload.js';

import { failPayout } from './fail.js';
import { PAYOUT_SEND_JOB, sendPayoutPayloadSchema } from './payload.js';
import { type PayoutGateway, RazorpayXError, razorpayxPayouts } from './razorpayx.js';

/**
 * Hands one payout to RazorpayX (§16.6), outside any transaction (rule 4).
 *
 * The row is CLAIMED first — `pending` → `processing`, committed — so a bank
 * change can no longer cancel it once the money may be moving: `cancelPending`
 * only touches `pending`. A `processing` row with no RazorpayX id is a claim
 * whose call never landed (an outage, a crash); a redelivery resumes it, and
 * `X-Payout-Idempotency: <payout id>` makes that resend return the original
 * payout if the first attempt did land.
 *
 * A 4xx is RazorpayX refusing the payout: it fails, and the balance is owed
 * again. Anything else throws, and pg-boss retries with backoff.
 */
export async function sendPayout(
  deps: JobDeps,
  raw: unknown,
  gateway: PayoutGateway = razorpayxPayouts,
  accountNumber: string | undefined = env.RAZORPAYX_ACCOUNT_NUMBER,
): Promise<void> {
  const { payoutId } = parsePaymentJobPayload(sendPayoutPayloadSchema, raw, PAYOUT_SEND_JOB);
  if (accountNumber === undefined) {
    throw new Error(
      `${PAYOUT_SEND_JOB}: RAZORPAYX_ACCOUNT_NUMBER is not set; payout ${payoutId} waits`,
    );
  }

  const [claimed] = await deps.db
    .update(payouts)
    .set({ status: 'processing', initiatedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'pending')))
    .returning();
  const [payout] =
    claimed !== undefined
      ? [claimed]
      : await deps.db
          .select()
          .from(payouts)
          .where(
            and(
              eq(payouts.id, payoutId),
              eq(payouts.status, 'processing'),
              isNull(payouts.razorpayPayoutId),
            ),
          );
  if (payout === undefined) {
    logger.info({ payoutId }, `${PAYOUT_SEND_JOB}: already sent, or no longer payable`);
    return;
  }

  // A fresh claim pays only if the account it was made for is still the
  // payee's: a change that committed while this payout was being created was
  // invisible to `cancelPending`, and must fail it rather than let it go to the
  // old account. A resumed claim (the first attempt may have landed) resends to
  // the pinned account under the same idempotency key, whatever changed since.
  if (claimed !== undefined) {
    const [bank] = await deps.db
      .select({ fundAccountId: bankDetails.razorpayxFundAccountId })
      .from(bankDetails)
      .where(eq(bankDetails.userId, payout.userId));
    if (bank?.fundAccountId !== payout.razorpayxFundAccountId) {
      await failPayout(deps, payoutId, 'bank details changed before sending');
      return;
    }
  }

  let sent;
  try {
    sent = await gateway.create({
      payoutId,
      accountNumber,
      fundAccountId: payout.razorpayxFundAccountId,
      amountPaise: payout.netPaise,
      period: payout.period,
    });
  } catch (error) {
    if (error instanceof RazorpayXError && error.rejected) {
      await failPayout(deps, payoutId, `razorpayx refused (${String(error.status)})`);
      return;
    }
    logger.warn({ payoutId, err: error }, `${PAYOUT_SEND_JOB}: RazorpayX unavailable, will retry`);
    throw error;
  }

  await deps.db
    .update(payouts)
    .set({ razorpayPayoutId: sent.id, updatedAt: new Date() })
    .where(eq(payouts.id, payoutId));
}
