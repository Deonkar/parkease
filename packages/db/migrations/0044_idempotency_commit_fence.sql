-- 0044_idempotency_commit_fence.sql
-- S-64: a request's domain transaction now writes `committed_at` on its own idempotency claim, in
-- the same transaction, and only while that claim still holds the key (`locked_at` unchanged).
-- Two things follow. An attempt that ran past IDEMPOTENCY_IN_FLIGHT_STALE_MS and was taken over
-- can no longer commit: its fence matches no row and the transaction rolls back. And a claim whose
-- write committed but whose response was never stored is never taken over and re-run; the retry
-- is told the request already went through. Nullable with no default: existing rows predate it.
SET lock_timeout = '5s';

ALTER TABLE idempotency_keys ADD COLUMN committed_at timestamptz;
