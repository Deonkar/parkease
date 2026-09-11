import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const brandedId = <B extends string>(_brand: B) => z.string().uuid().brand<B>();

export const userIdSchema = brandedId('UserId');
export const spaceIdSchema = brandedId('SpaceId');
export const spaceSlotIdSchema = brandedId('SpaceSlotId');
export const bookingIdSchema = brandedId('BookingId');
export const paymentIdSchema = brandedId('PaymentId');
export const payoutIdSchema = brandedId('PayoutId');
export const valetJobIdSchema = brandedId('ValetJobId');
export const washJobIdSchema = brandedId('WashJobId');
export const reviewIdSchema = brandedId('ReviewId');
export const notificationIdSchema = brandedId('NotificationId');
export const idempotencyKeySchema = brandedId('IdempotencyKey');
export const txnIdSchema = brandedId('TxnId');

export type UserId = z.infer<typeof userIdSchema>;
export type SpaceId = z.infer<typeof spaceIdSchema>;
export type SpaceSlotId = z.infer<typeof spaceSlotIdSchema>;
export type BookingId = z.infer<typeof bookingIdSchema>;
export type PaymentId = z.infer<typeof paymentIdSchema>;
export type PayoutId = z.infer<typeof payoutIdSchema>;
export type ValetJobId = z.infer<typeof valetJobIdSchema>;
export type WashJobId = z.infer<typeof washJobIdSchema>;
export type ReviewId = z.infer<typeof reviewIdSchema>;
export type NotificationId = z.infer<typeof notificationIdSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type TxnId = z.infer<typeof txnIdSchema>;
