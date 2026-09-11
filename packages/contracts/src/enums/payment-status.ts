import { z } from 'zod';

export const PAYMENT_STATUS_VALUES = [
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const PaymentStatus = {
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const satisfies Record<string, PaymentStatus>;

type _MissingFromObject = Exclude<
  PaymentStatus,
  (typeof PaymentStatus)[keyof typeof PaymentStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
