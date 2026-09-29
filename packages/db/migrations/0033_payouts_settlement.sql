-- 0033_payouts_settlement.sql — hand-written
-- Task 16a: payouts, settlement and tax.
--
-- `payouts` and `bank_details` have never been written outside Testcontainers
-- (no code path reads or writes either before this task), so their DDL takes
-- ACCESS EXCLUSIVE on an empty table for microseconds, behind migrate.ts's 5s
-- lock_timeout. `ledger_entries` and `payments` carry rows, so their CHECKs are
-- added NOT VALID here and validated in 0034 under SHARE UPDATE EXCLUSIVE —
-- the 0031/0032 split, because a VALIDATE in this file would scan under the
-- ADD CONSTRAINT's ACCESS EXCLUSIVE.
--
-- FORWARD-ONLY. Nothing here drops data: the one rename (payouts.amount_paise)
-- is on an empty table with no readers.

-- ---------------------------------------------------------------------------
-- 1. settlement_clearing joins the chart of accounts
-- ---------------------------------------------------------------------------
--
-- Credited when money leaves us (a Route transfer at capture, a RazorpayX
-- payout), debited when the rail confirms it arrived. Its balance is money in
-- transit; a non-zero balance past T+3 is a reconciliation mismatch.
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_account_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_account_check CHECK (
    account IN (
      'driver_receivable','owner_payable','platform_revenue','gst_payable',
      'tcs_payable','tds_payable','gateway_fees','refunds_payable','promo_expense',
      'settlement_clearing'
    )
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 2. payments.route_transfer_paise — what Route moved, as we asked it to
-- ---------------------------------------------------------------------------
--
-- Written at order creation from the transfer we attached. Capture posts the
-- owner_payable discharge from exactly this number, and reconciliation compares
-- Razorpay's transfer against it, so neither has to recompute a split. NULL for
-- orders with no transfer and for rows created before this migration.
ALTER TABLE payments ADD COLUMN route_transfer_paise bigint;

ALTER TABLE payments
  ADD CONSTRAINT payments_route_transfer_paise_check
    CHECK (route_transfer_paise IS NULL OR route_transfer_paise > 0) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. payouts — one per (user, ISO week), with the tax split on the row
-- ---------------------------------------------------------------------------
ALTER TABLE payouts RENAME COLUMN amount_paise TO net_paise;
ALTER TABLE payouts RENAME CONSTRAINT payouts_amount_check TO payouts_net_paise_check;

ALTER TABLE payouts
  ADD COLUMN period text NOT NULL,
  ADD COLUMN gross_paise bigint NOT NULL,
  ADD COLUMN tcs_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN tds_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN txn_id uuid NOT NULL,
  -- Pinned when the payout is created: the send pays exactly the account the
  -- payout was made for, and a bank change after that fails it rather than
  -- redirecting it (review finding: never pay an account the row did not name).
  ADD COLUMN razorpayx_fund_account_id text NOT NULL;

ALTER TABLE payouts
  ADD CONSTRAINT payouts_split_check
    CHECK (tcs_paise >= 0 AND tds_paise >= 0
           AND gross_paise = net_paise + tcs_paise + tds_paise);

ALTER TABLE payouts DROP CONSTRAINT payouts_status_check;
ALTER TABLE payouts
  ADD CONSTRAINT payouts_status_check CHECK (
    status IN ('pending','processing','paid','failed','reversed','cancelled')
  );

-- The idempotency key of the weekly run: a redelivery or a second Monday run
-- for the same week inserts nothing. It also serves user_id lookups, so the
-- plain index is redundant.
CREATE UNIQUE INDEX payouts_user_id_period_key ON payouts (user_id, period);
DROP INDEX payouts_user_id_idx;

-- Reconciliation polls the in-flight ones daily.
CREATE INDEX payouts_status_idx ON payouts (status) WHERE status = 'processing';

-- ---------------------------------------------------------------------------
-- 4. bank_details — one row per user, carrying its RazorpayX ids
-- ---------------------------------------------------------------------------
--
-- The Fund Account lives on the bank-details row it was created from, so
-- changing bank details replaces it in the same UPDATE: there is no moment at
-- which a payout could reference the old account.
ALTER TABLE bank_details
  ADD COLUMN ifsc_prefix text NOT NULL,
  ADD COLUMN razorpayx_contact_id text,
  ADD COLUMN razorpayx_fund_account_id text;

CREATE UNIQUE INDEX bank_details_user_id_key ON bank_details (user_id);
DROP INDEX bank_details_user_id_idx;

-- ---------------------------------------------------------------------------
-- 5. reconciliation_mismatches — the queue task 18's admin panel reads
-- ---------------------------------------------------------------------------
--
-- unique(kind, reference) over UNRESOLVED rows is what makes the daily job
-- idempotent: a second run finds the open row and inserts nothing (R-ASYNC-03),
-- while the same problem recurring after an operator resolved it opens anew.
CREATE TABLE reconciliation_mismatches (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind text NOT NULL,
  reference text NOT NULL,
  expected_paise bigint,
  actual_paise bigint,
  detail text NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_mismatches_kind_check
    CHECK (kind IN ('amount_mismatch','missing_transfer','payout_failed'))
);

CREATE UNIQUE INDEX reconciliation_mismatches_kind_reference_key
  ON reconciliation_mismatches (kind, reference) WHERE resolved_at IS NULL;
CREATE INDEX reconciliation_mismatches_unresolved_idx
  ON reconciliation_mismatches (created_at) WHERE resolved_at IS NULL;
