import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';

import { users } from './identity.js';

/**
 * One RazorpayX payout per (user, ISO week in IST) — `payouts_user_id_period_key`
 * is the weekly job's idempotency key. `gross = net + tcs + tds` is a CHECK, so
 * the row cannot disagree with the ledger posting it carries in `txn_id`.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** ISO week in IST, `2026-W40`. */
    period: text('period').notNull(),
    grossPaise: paise('gross_paise').notNull(),
    tcsPaise: paise('tcs_paise').notNull().default(0),
    tdsPaise: paise('tds_paise').notNull().default(0),
    /** What actually leaves: gross less withholding. */
    netPaise: paise('net_paise').notNull(),
    txnId: uuid('txn_id').notNull(),
    /** The account this payout was made for; `payout.send` pays exactly this. */
    razorpayxFundAccountId: text('razorpayx_fund_account_id').notNull(),
    status: text('status').notNull().default('pending'),
    razorpayPayoutId: text('razorpay_payout_id'),
    razorpayContactId: text('razorpay_contact_id'),
    failureReason: text('failure_reason'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payouts_user_id_period_key').on(t.userId, t.period),
    index('payouts_status_idx')
      .on(t.status)
      .where(sql`${t.status} = 'processing'`),
    check('payouts_net_paise_check', sql`${t.netPaise} > 0`),
    check(
      'payouts_split_check',
      sql`${t.tcsPaise} >= 0 AND ${t.tdsPaise} >= 0
          AND ${t.grossPaise} = ${t.netPaise} + ${t.tcsPaise} + ${t.tdsPaise}`,
    ),
    check(
      'payouts_status_check',
      sql`${t.status} IN ('pending','processing','paid','failed','reversed','cancelled')`,
    ),
  ],
);

export const bankDetails = pgTable(
  'bank_details',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** AES-256-GCM, `iv.tag.ciphertext`. Never returned in full (R-SEC-05). */
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    ifscEncrypted: text('ifsc_encrypted').notNull(),
    upiIdEncrypted: text('upi_id_encrypted'),
    accountHolderName: text('account_holder_name').notNull(),
    last4: text('last4').notNull(),
    /** The bank code, `HDFC` — the masked view's only IFSC fragment. */
    ifscPrefix: text('ifsc_prefix').notNull(),
    isPrimary: text('is_primary').notNull().default('true'),
    razorpayxContactId: text('razorpayx_contact_id'),
    /** Replaced in the same UPDATE as the bank details it was created from. */
    razorpayxFundAccountId: text('razorpayx_fund_account_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('bank_details_user_id_key').on(t.userId)],
);

export const linkedAccounts = pgTable(
  'linked_accounts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    razorpayAccountId: text('razorpay_account_id').notNull(),
    kycStatus: text('kyc_status').notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    index('linked_accounts_user_id_idx').on(t.userId),
    check(
      'linked_accounts_kyc_status_check',
      sql`${t.kycStatus} IN ('pending','activated','needs_clarification','suspended')`,
    ),
  ],
);

/**
 * What reconciliation found that the ledger does not explain. Task 18's admin
 * panel is the queue; `unique(kind, reference)` makes a re-run insert nothing.
 */
export const reconciliationMismatches = pgTable(
  'reconciliation_mismatches',
  {
    id: primaryId(),
    kind: text('kind').notNull(),
    reference: text('reference').notNull(),
    expectedPaise: paise('expected_paise'),
    actualPaise: paise('actual_paise'),
    detail: text('detail').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reconciliation_mismatches_kind_reference_key')
      .on(t.kind, t.reference)
      .where(sql`${t.resolvedAt} IS NULL`),
    index('reconciliation_mismatches_unresolved_idx')
      .on(t.createdAt)
      .where(sql`${t.resolvedAt} IS NULL`),
    check(
      'reconciliation_mismatches_kind_check',
      sql`${t.kind} IN ('amount_mismatch','missing_transfer','payout_failed')`,
    ),
  ],
);
