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
    /**
     * What we told Razorpay to charge, fixed at order creation. The capture is
     * compared against exactly this, in integer paise, with `===` — so the name
     * has to say which of the two amounts it is (R-SEC-09).
     */
    expectedTotalPaise: paise('expected_total_paise').notNull(),
    /** What Razorpay says actually moved. NULL until the capture webhook lands. */
    capturedPaise: paise('captured_paise'),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('created'),
    /** Razorpay's own method vocabulary. NULL until Razorpay tells us. */
    method: text('method'),
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
    check('payments_amount_check', sql`${t.expectedTotalPaise} > 0`),
    // Drizzle reads bigint money with `mode: 'number'`. Past 2^53-1 that read is
    // silently lossy, and a silently rounded amount compared with `===` is a
    // mismatch nobody can explain (R-MONEY-01).
    check(
      'payments_expected_total_safe_integer_check',
      sql`${t.expectedTotalPaise} < 9007199254740991`,
    ),
    check(
      'payments_captured_paise_check',
      sql`${t.capturedPaise} IS NULL OR (${t.capturedPaise} > 0 AND ${t.capturedPaise} < 9007199254740991)`,
    ),
    check(
      'payments_method_check',
      sql`${t.method} IS NULL OR ${t.method} IN ('upi','card','netbanking','wallet','emi','bank_transfer')`,
    ),
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
    /**
     * `text`, not `uuid`. ADR-011 deduplicates Razorpay webhooks on the Razorpay
     * event id in this same table, and `evt_QK7xVv9pLm2Zab` is not a UUID. The
     * UUID shape is still required of client-minted keys — at the HTTP boundary,
     * by `IdempotencyInterceptor`, where a malformed key can be answered with a
     * 400 instead of a constraint violation.
     */
    key: text('key').primaryKey(),
    /**
     * NULL only where there genuinely is no user: a gateway webhook, or an
     * /auth route that is itself creating the session. Enforced by
     * `idempotency_keys_user_or_public_check`, because a key with no owner on a
     * user route is a key any user can replay.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
    check(
      'idempotency_keys_user_or_public_check',
      sql`${t.userId} IS NOT NULL OR ${t.endpoint} LIKE 'POST /api/v1/webhooks/%' OR ${t.endpoint} LIKE 'POST /api/v1/auth/%'`,
    ),
  ],
);
