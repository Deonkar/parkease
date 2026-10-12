-- 0053_ledger_occurred_at_id_idx.sql
-- S-138: the ledger explorer and the export read ORDER BY occurred_at, id over a date range. The
-- only time-ordered index was (account, occurred_at), so an unfiltered range sorted every row
-- before returning the first (~0.5s on 250k rows, growing with the table). Alone in its file:
-- CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ledger_entries_occurred_at_id_idx ON ledger_entries (occurred_at, id);
