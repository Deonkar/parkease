-- 0019_payments_capture.sql — hand-written
-- Task 9, phase 1 of 5. The payments table, reshaped for capture.
--
-- Three columns the capture path needs and 0006 did not have:
--
--   expected_total_paise  what we told Razorpay to charge, fixed at order
--                         creation. `amount_paise` was ambiguous about whether
--                         it meant the order or the capture, and the whole point
--                         of R-SEC-09 is that those two are compared, never
--                         conflated. A name that cannot say which one it is is a
--                         name that will eventually be read as the wrong one.
--   captured_paise        what Razorpay says actually moved. NULL until capture.
--   method                upi / card / netbanking / wallet, for support and for
--                         the failure funnel. NULL until Razorpay tells us.
--
-- The rename is a straight RENAME rather than expand-contract because this table
-- has never been written to: no code reads or writes `payments` before this task
-- (grep confirms only ledger_entries.payment_id references it), and every
-- environment has zero rows. Expand-contract exists to protect live readers, and
-- there are none to protect.
--
-- All four statements are catalog-only on PostgreSQL 11+: RENAME touches
-- pg_attribute, ADD COLUMN of a nullable column with no DEFAULT writes no rows,
-- and CHECK ... NOT VALID checks nothing. ACCESS EXCLUSIVE is held for
-- microseconds, and migrate.ts sets lock_timeout to 5s so it fails fast rather
-- than queueing behind a slow query.

ALTER TABLE payments RENAME COLUMN amount_paise TO expected_total_paise;

ALTER TABLE payments ADD COLUMN captured_paise bigint;

ALTER TABLE payments ADD COLUMN method text;

-- Drizzle reads bigint money columns with `mode: 'number'`, so a value past
-- 2^53-1 would arrive silently rounded — and a silently rounded amount compared
-- with `===` against the order is a mismatch nobody can explain. ₹90 trillion is
-- not a booking; this is the database refusing to represent what the application
-- cannot faithfully read back (R-MONEY-01).
ALTER TABLE payments
  ADD CONSTRAINT payments_expected_total_safe_integer_check
  CHECK (expected_total_paise < 9007199254740991)
  NOT VALID;

ALTER TABLE payments
  ADD CONSTRAINT payments_captured_paise_check
  CHECK (captured_paise IS NULL OR (captured_paise > 0 AND captured_paise < 9007199254740991))
  NOT VALID;

-- Razorpay's own method vocabulary, narrowed to what Checkout can return for an
-- INR order. TEXT + CHECK rather than a PG enum type, per R-DB-02.
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IS NULL OR method IN ('upi','card','netbanking','wallet','emi','bank_transfer'))
  NOT VALID;
