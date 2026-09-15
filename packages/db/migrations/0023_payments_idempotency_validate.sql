-- 0023_payments_idempotency_validate.sql — hand-written
-- Task 9, phase 5 of 5. Validates what 0019 and 0022 declared.
--
-- VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, not ACCESS EXCLUSIVE: it
-- scans the existing rows while reads and writes carry on around it. That is the
-- whole reason the NOT VALID declaration and this scan are separate files —
-- declaring and validating in one statement would hold the strong lock for the
-- length of the scan.
--
-- The constraints have been enforcing themselves on every new and updated row
-- since 0019 and 0022 committed. This only settles the rows that predate them.

ALTER TABLE payments VALIDATE CONSTRAINT payments_expected_total_safe_integer_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_captured_paise_check;
ALTER TABLE payments VALIDATE CONSTRAINT payments_method_check;
ALTER TABLE idempotency_keys VALIDATE CONSTRAINT idempotency_keys_user_or_public_check;
