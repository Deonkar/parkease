import { z } from 'zod';

export const REFUND_STATUS_VALUES = ['pending', 'processed', 'failed'] as const;

export const refundStatusSchema = z.enum(REFUND_STATUS_VALUES);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

export const RefundStatus = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const satisfies Record<string, RefundStatus>;

type _MissingFromObject = Exclude<RefundStatus, (typeof RefundStatus)[keyof typeof RefundStatus]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
