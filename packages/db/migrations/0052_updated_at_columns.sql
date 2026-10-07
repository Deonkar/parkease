-- 0052_updated_at_columns.sql
-- S-158: `resolved_at` means the row is updated, and every mutable table carries `updated_at`
-- (schema conformance test). A constant default makes this a metadata-only ADD COLUMN.
SET lock_timeout = '5s';

ALTER TABLE reconciliation_mismatches
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- commission_waivers had the same gap; an operator revoke (S-120) updates `ends_at`.
ALTER TABLE commission_waivers
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
