-- 0006_payment_ledger_payout.sql
-- payments, refunds, idempotency_keys, ledger_entries, payouts, bank_details, linked_accounts

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  user_id uuid NOT NULL REFERENCES users(id),
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  amount_paise bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created',
  failure_reason text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_check CHECK (amount_paise > 0),
  CONSTRAINT payments_status_check CHECK (
    status IN ('created','authorized','captured','failed','refunded','partially_refunded')
  )
);

CREATE UNIQUE INDEX payments_razorpay_order_id_key ON payments (razorpay_order_id);
CREATE UNIQUE INDEX payments_razorpay_payment_id_key ON payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX payments_booking_id_idx ON payments (booking_id);
CREATE INDEX payments_user_id_idx ON payments (user_id);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  razorpay_refund_id text,
  amount_paise bigint NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_amount_check CHECK (amount_paise > 0),
  CONSTRAINT refunds_status_check CHECK (status IN ('pending','processed','failed'))
);

CREATE INDEX refunds_payment_id_idx ON refunds (payment_id);
CREATE UNIQUE INDEX refunds_razorpay_refund_id_key ON refunds (razorpay_refund_id)
  WHERE razorpay_refund_id IS NOT NULL;

CREATE TABLE idempotency_keys (
  key uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  locked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_keys_user_id_idx ON idempotency_keys (user_id);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_paise bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  razorpay_payout_id text,
  razorpay_contact_id text,
  failure_reason text,
  initiated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_amount_check CHECK (amount_paise > 0),
  CONSTRAINT payouts_status_check CHECK (
    status IN ('pending','processing','paid','failed','reversed')
  )
);

CREATE INDEX payouts_user_id_idx ON payouts (user_id);

CREATE TABLE bank_details (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_number_encrypted text NOT NULL,
  ifsc_encrypted text NOT NULL,
  upi_id_encrypted text,
  account_holder_name text NOT NULL,
  last4 text NOT NULL,
  is_primary text NOT NULL DEFAULT 'true',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bank_details_user_id_idx ON bank_details (user_id);

CREATE TABLE linked_accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_account_id text NOT NULL,
  kyc_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linked_accounts_kyc_status_check CHECK (
    kyc_status IN ('pending','activated','needs_clarification','suspended')
  )
);

CREATE INDEX linked_accounts_user_id_idx ON linked_accounts (user_id);

CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  txn_id uuid NOT NULL,
  account text NOT NULL,
  direction text NOT NULL,
  amount_paise bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  booking_id uuid REFERENCES bookings(id),
  payout_id uuid REFERENCES payouts(id),
  payment_id uuid REFERENCES payments(id),
  counterparty_user_id uuid REFERENCES users(id),
  description text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_amount_check CHECK (amount_paise > 0),
  CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('debit','credit')),
  CONSTRAINT ledger_entries_account_check CHECK (
    account IN (
      'driver_receivable','owner_payable','platform_revenue','gst_payable',
      'tcs_payable','tds_payable','gateway_fees','refunds_payable','promo_expense'
    )
  ),
  CONSTRAINT ledger_entries_currency_check CHECK (currency = 'INR')
);

CREATE INDEX ledger_entries_txn_id_idx ON ledger_entries (txn_id);
CREATE INDEX ledger_entries_account_occurred_at_idx ON ledger_entries (account, occurred_at);
CREATE INDEX ledger_entries_booking_id_idx ON ledger_entries (booking_id);
CREATE INDEX ledger_entries_payout_id_idx ON ledger_entries (payout_id);
CREATE INDEX ledger_entries_payment_id_idx ON ledger_entries (payment_id);
CREATE INDEX ledger_entries_counterparty_user_id_idx ON ledger_entries (counterparty_user_id);
