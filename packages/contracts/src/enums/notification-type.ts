import { z } from 'zod';

export const NOTIFICATION_TYPE_VALUES = [
  'booking_confirmed',
  'booking_reminder',
  'booking_expired',
  'booking_cancelled',
  'valet_assigned',
  'valet_arrived',
  'valet_parked',
  'wash_accepted',
  'wash_completed',
  'payout_processed',
  'review_request',
  'space_approved',
  'space_rejected',
  'weekly_summary',
] as const;

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPE_VALUES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NotificationType = {
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_REMINDER: 'booking_reminder',
  BOOKING_EXPIRED: 'booking_expired',
  BOOKING_CANCELLED: 'booking_cancelled',
  VALET_ASSIGNED: 'valet_assigned',
  VALET_ARRIVED: 'valet_arrived',
  VALET_PARKED: 'valet_parked',
  WASH_ACCEPTED: 'wash_accepted',
  WASH_COMPLETED: 'wash_completed',
  PAYOUT_PROCESSED: 'payout_processed',
  REVIEW_REQUEST: 'review_request',
  SPACE_APPROVED: 'space_approved',
  SPACE_REJECTED: 'space_rejected',
  WEEKLY_SUMMARY: 'weekly_summary',
} as const satisfies Record<string, NotificationType>;

type _MissingFromObject = Exclude<
  NotificationType,
  (typeof NotificationType)[keyof typeof NotificationType]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
