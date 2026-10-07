-- 0046_bank_details_payout_hold.sql
-- S-100: after bank details are CHANGED, no payout leaves for the new account until this time
-- (48 hours on). The account holder hears about every change; the hold is the window in which a
-- change they did not make can be reported before money moves. NULL: no hold (first details, or
-- the hold has passed). Nullable, no default: a metadata-only ADD COLUMN.
SET lock_timeout = '5s';

ALTER TABLE bank_details ADD COLUMN payouts_held_until timestamptz;
