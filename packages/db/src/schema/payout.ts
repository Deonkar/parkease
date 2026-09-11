import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId, timestamps } from '../columns/common.js';

import { users } from './identity.js';

export const payouts = pgTable(
  'payouts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amountPaise: paise('amount_paise').notNull(),
    status: text('status').notNull().default('pending'),
    razorpayPayoutId: text('razorpay_payout_id'),
    razorpayContactId: text('razorpay_contact_id'),
    failureReason: text('failure_reason'),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('payouts_user_id_idx').on(t.userId),
    check('payouts_amount_check', sql`${t.amountPaise} > 0`),
    check(
      'payouts_status_check',
      sql`${t.status} IN ('pending','processing','paid','failed','reversed')`,
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
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    ifscEncrypted: text('ifsc_encrypted').notNull(),
    upiIdEncrypted: text('upi_id_encrypted'),
    accountHolderName: text('account_holder_name').notNull(),
    last4: text('last4').notNull(),
    isPrimary: text('is_primary').notNull().default('true'),
    ...timestamps,
  },
  (t) => [index('bank_details_user_id_idx').on(t.userId)],
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
