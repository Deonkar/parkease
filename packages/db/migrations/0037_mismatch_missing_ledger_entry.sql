-- 0037_mismatch_missing_ledger_entry.sql — hand-written
-- Task 16 §16.7: reconciliation also asks the other way round — a Route
-- transfer Razorpay made that no payment of ours recorded is money that left
-- without the ledger knowing (`missing_ledger_entry`).
--
-- The new set is a strict superset of the old one, so no existing row can fail
-- it. reconciliation_mismatches is the operator queue: nothing on a request path
-- writes it, and it holds a handful of rows, so the one-step CHECK validates in
-- microseconds behind migrate.ts's 5s lock_timeout. FORWARD-ONLY.
ALTER TABLE reconciliation_mismatches DROP CONSTRAINT reconciliation_mismatches_kind_check;
ALTER TABLE reconciliation_mismatches
  ADD CONSTRAINT reconciliation_mismatches_kind_check CHECK (
    kind IN ('amount_mismatch','missing_transfer','payout_failed','missing_ledger_entry')
  );
