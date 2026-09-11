import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    razorpayOrderId: text('razorpay_order_id').notNull(),
    razorpayPaymentId: text('razorpay_payment_id'),
    amountPaise: paise('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('created'),
    failureReason: text('failure_reason'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payments_razorpay_order_id_key').on(t.razorpayOrderId),
    uniqueIndex('payments_razorpay_payment_id_key')
      .on(t.razorpayPaymentId)
      .where(sql`${t.razorpayPaymentId} IS NOT NULL`),
    index('payments_booking_id_idx').on(t.bookingId),
    index('payments_user_id_idx').on(t.userId),
    check('payments_amount_check', sql`${t.amountPaise} > 0`),
    check(
      'payments_status_check',
      sql`${t.status} IN ('created','authorized','captured','failed','refunded','partially_refunded')`,
    ),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    razorpayRefundId: text('razorpay_refund_id'),
    amountPaise: paise('amount_paise').notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('refunds_payment_id_idx').on(t.paymentId),
    uniqueIndex('refunds_razorpay_refund_id_key')
      .on(t.razorpayRefundId)
      .where(sql`${t.razorpayRefundId} IS NOT NULL`),
    check('refunds_amount_check', sql`${t.amountPaise} > 0`),
    check('refunds_status_check', sql`${t.status} IN ('pending','processed','failed')`),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: uuid('key').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idempotency_keys_user_id_idx').on(t.userId),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
  ],
);
