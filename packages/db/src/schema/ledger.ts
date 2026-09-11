import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { paise, primaryId } from '../columns/common.js';

import { bookings } from './booking.js';
import { users } from './identity.js';
import { payments } from './payment.js';
import { payouts } from './payout.js';

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: primaryId(),
    txnId: uuid('txn_id').notNull(),
    account: text('account').notNull(),
    direction: text('direction').notNull(),
    amountPaise: paise('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    bookingId: uuid('booking_id').references(() => bookings.id),
    payoutId: uuid('payout_id').references(() => payouts.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    counterpartyUserId: uuid('counterparty_user_id').references(() => users.id),
    description: text('description').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_txn_id_idx').on(t.txnId),
    index('ledger_entries_account_occurred_at_idx').on(t.account, t.occurredAt),
    index('ledger_entries_booking_id_idx').on(t.bookingId),
    index('ledger_entries_payout_id_idx').on(t.payoutId),
    index('ledger_entries_payment_id_idx').on(t.paymentId),
    index('ledger_entries_counterparty_user_id_idx').on(t.counterpartyUserId),
    check('ledger_entries_amount_check', sql`${t.amountPaise} > 0`),
    check('ledger_entries_direction_check', sql`${t.direction} IN ('debit','credit')`),
    check(
      'ledger_entries_account_check',
      sql`${t.account} IN (
        'driver_receivable','owner_payable','platform_revenue','gst_payable',
        'tcs_payable','tds_payable','gateway_fees','refunds_payable','promo_expense'
      )`,
    ),
    check('ledger_entries_currency_check', sql`${t.currency} = 'INR'`),
  ],
);
