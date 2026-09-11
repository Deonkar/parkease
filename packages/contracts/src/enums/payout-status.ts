import { z } from 'zod';

export const PAYOUT_STATUS_VALUES = [
  'pending',
  'processing',
  'paid',
  'failed',
  'reversed',
] as const;

export const payoutStatusSchema = z.enum(PAYOUT_STATUS_VALUES);
export type PayoutStatus = z.infer<typeof payoutStatusSchema>;

export const PayoutStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  REVERSED: 'reversed',
} as const satisfies Record<string, PayoutStatus>;

type _MissingFromObject = Exclude<PayoutStatus, (typeof PayoutStatus)[keyof typeof PayoutStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
