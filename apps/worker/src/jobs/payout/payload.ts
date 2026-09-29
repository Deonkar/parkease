import { z } from 'zod';

export const PAYOUT_RUN_WEEKLY_JOB = 'payout.run-weekly';
export const PAYOUT_SEND_JOB = 'payout.send';
export const PAYOUT_RECONCILE_JOB = 'payout.reconcile';

/** ₹100 (§16.6). Below it, the balance waits for next week. */
export const MINIMUM_PAYOUT_PAISE = 10_000;

export const sendPayoutPayloadSchema = z.object({ payoutId: z.string().uuid() });
