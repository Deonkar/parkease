import { z } from 'zod';

export const BOOKING_STATUS_VALUES = [
  'pending_payment',
  'confirmed',
  'active',
  'completed',
  'cancelled',
  'expired',
  'no_show',
] as const;

export const bookingStatusSchema = z.enum(BOOKING_STATUS_VALUES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const BookingStatus = {
  PENDING_PAYMENT: 'pending_payment',
  CONFIRMED: 'confirmed',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  NO_SHOW: 'no_show',
} as const satisfies Record<string, BookingStatus>;

type _MissingFromObject = Exclude<
  BookingStatus,
  (typeof BookingStatus)[keyof typeof BookingStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
