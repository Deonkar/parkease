-- 0034_payouts_settlement_validate.sql — hand-written
-- Validates the two CHECKs 0033 added NOT VALID. Its own file so the scan runs
-- under SHARE UPDATE EXCLUSIVE, not 0033's ACCESS EXCLUSIVE (learnings:
-- "SET LOCAL in a migration file is scoped to that file"). Every existing row
-- already satisfies both: the account list only widened, and the new payments
-- column is NULL everywhere.
ALTER TABLE ledger_entries VALIDATE CONSTRAINT ledger_entries_account_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_route_transfer_paise_check;
