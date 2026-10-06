import { z } from 'zod';

import { bookingStatusSchema } from '../enums/booking-status.js';
import { paymentStatusSchema } from '../enums/payment-status.js';
import { refundStatusSchema } from '../enums/refund-status.js';
import {
  bookingIdSchema,
  paymentIdSchema,
  spaceIdSchema,
  userIdSchema,
} from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

import { ledgerEntrySchema } from './ledger.js';
import { adminPageQuerySchema, istDateSchema } from './query.js';

export const ADMIN_REFUND_OPTION_VALUES = ['full_minus_fee', 'half', 'custom'] as const;

export const adminRefundOptionSchema = z.enum(ADMIN_REFUND_OPTION_VALUES);
export type AdminRefundOption = z.infer<typeof adminRefundOptionSchema>;

const refundReasonSchema = z.string().trim().min(1).max(500);

/**
 * The preset options carry no amount: the server computes them, so a client can never
 * send a price. Only `custom` names an amount, and it must be a positive integer paise.
 */
export const adminRefundSchema = z.discriminatedUnion('option', [
  z.object({ option: z.literal('full_minus_fee'), reason: refundReasonSchema }),
  z.object({ option: z.literal('half'), reason: refundReasonSchema }),
  z.object({
    option: z.literal('custom'),
    amountPaise: paiseSchema.refine((amount) => amount > 0, {
      message: 'Refund amount must be greater than zero',
    }),
    reason: refundReasonSchema,
  }),
]);

export type AdminRefund = z.infer<typeof adminRefundSchema>;

/** What each preset would refund right now, so the admin sees the number before confirming. */
export const refundOptionSchema = z.object({
  option: adminRefundOptionSchema,
  amountPaise: paiseSchema,
});

export type RefundOption = z.infer<typeof refundOptionSchema>;

export const adminBookingsQuerySchema = adminPageQuerySchema.extend({
  status: bookingStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  from: istDateSchema.optional(),
  to: istDateSchema.optional(),
});

export type AdminBookingsQuery = z.infer<typeof adminBookingsQuerySchema>;

export const adminBookingListItemSchema = z.object({
  id: bookingIdSchema,
  status: bookingStatusSchema,
  driverName: z.string().nullable(),
  spaceTitle: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  totalPaise: paiseSchema,
});

export type AdminBookingListItem = z.infer<typeof adminBookingListItemSchema>;

export const adminBookingDetailSchema = z.object({
  id: bookingIdSchema,
  status: bookingStatusSchema,
  driver: z.object({
    id: userIdSchema,
    name: z.string().nullable(),
    /** `maskPhone` output. */
    phone: z.string(),
  }),
  space: z.object({
    id: spaceIdSchema,
    title: z.string(),
    ownerName: z.string().nullable(),
  }),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  totalPaise: paiseSchema,
  ownerEarningsPaise: paiseSchema,
  parkeaseFeePaise: paiseSchema,
  gstPaise: paiseSchema,
  ledger: z.array(ledgerEntrySchema),
  payments: z.array(
    z.object({
      id: paymentIdSchema,
      status: paymentStatusSchema,
      amountPaise: paiseSchema,
      razorpayPaymentId: z.string().nullable(),
    }),
  ),
  refunds: z.array(
    z.object({
      id: z.string().uuid(),
      amountPaise: paiseSchema,
      status: refundStatusSchema,
      reason: z.string().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  /** Captured less what was already refunded: the ceiling for any refund option. */
  refundablePaise: paiseSchema,
  refundOptions: z.array(refundOptionSchema),
});

export type AdminBookingDetail = z.infer<typeof adminBookingDetailSchema>;
