-- 0055_payouts_destination_last4.sql
-- S-113: a payout names the account it was paid to, as it was when the payout was made. Stamping
-- the CURRENT bank on every row renamed past payouts after a bank change. Nullable: rows written
-- before this keep saying "To your bank". Metadata-only ADD COLUMN.
SET lock_timeout = '5s';

ALTER TABLE payouts ADD COLUMN destination_last4 text;
ALTER TABLE payouts
  ADD CONSTRAINT payouts_destination_last4_check
  CHECK (destination_last4 IS NULL OR destination_last4 ~ '^[0-9]{4}$');
