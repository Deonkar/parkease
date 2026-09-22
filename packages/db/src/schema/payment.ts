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
import { washJobs } from './carwash.js';
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
    /**
     * Which thing this order is for.
     *
     * §13.4: a car wash is an add-on requested after the booking is already
     * paid, at a price that depends on the winning partner's menu, so it gets a
     * Razorpay order of its own — hanging off the *same* booking. Without this
     * column, `findOpenForBooking` would hand a driver reopening Checkout for
     * their parking the car wash order instead: the right gateway id for the
     * wrong thing, at the wrong amount.
     */
    purpose: text('purpose').notNull().default('booking'),
    washJobId: uuid('wash_job_id').references(() => washJobs.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payments_razorpay_order_id_key').on(t.razorpayOrderId),
    uniqueIndex('payments_razorpay_payment_id_key')
      .on(t.razorpayPaymentId)
      .where(sql`${t.razorpayPaymentId} IS NOT NULL`),
    index('payments_booking_id_idx').on(t.bookingId),
    index('payments_user_id_idx').on(t.userId),
    // Built CONCURRENTLY in its own single-statement migration (0029), because
    // payments takes writes and a plain build would block all of them.
    index('payments_wash_job_id_idx')
      .on(t.washJobId)
      .where(sql`${t.washJobId} IS NOT NULL`),
    check('payments_purpose_check', sql`${t.purpose} IN ('booking','carwash')`),
    // The two columns cannot disagree. A 'carwash' payment with no job is an
    // order nobody can reconcile; a 'booking' payment carrying a job id is a
    // mislabelled row every purpose-scoped query would then answer wrongly.
    check(
      'payments_wash_job_coherence_check',
      sql`(${t.purpose} = 'carwash' AND ${t.washJobId} IS NOT NULL)
          OR (${t.purpose} = 'booking' AND ${t.washJobId} IS NULL)`,
    ),
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
