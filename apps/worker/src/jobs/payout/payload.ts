import { z } from 'zod';

export const PAYOUT_RUN_WEEKLY_JOB = 'payout.run-weekly';
export const PAYOUT_SEND_JOB = 'payout.send';
export const PAYOUT_RECONCILE_JOB = 'payout.reconcile';

export const sendPayoutPayloadSchema = z.object({ payoutId: z.string().uuid() });
