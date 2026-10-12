import { z } from 'zod';

export const PAYOUT_RUN_WEEKLY_JOB = 'payout.run-weekly';
export const PAYOUT_SEND_JOB = 'payout.send';
export const PAYOUT_RECONCILE_JOB = 'payout.reconcile';

export const sendPayoutPayloadSchema = z.object({ payoutId: z.string().uuid() });

export { PAYOUT_APPLY_STATUS_JOB } from '@parkease/contracts/public';

/** A RazorpayX payout event, as the API's webhook recorded it (S-102). */
export const applyPayoutStatusPayloadSchema = z.object({
  razorpayPayoutId: z.string().min(1),
  status: z.string().min(1),
});
