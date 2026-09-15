-- 0020_idempotency_keys_prune_guard.sql — hand-written
-- Task 9, phase 2 of 5. Makes 0021's rewrite provably cheap before it runs.
--
-- 0021 changes idempotency_keys.key from uuid to text. That is a full table
-- rewrite under ACCESS EXCLUSIVE, and idempotency_keys takes a write on *every
-- mutation the API serves* — so for the length of the rewrite, every POST in
-- ParkEase blocks. Row count is not what makes that safe or unsafe; the fact
-- that the lock blocks all writes is.
--
-- What makes it acceptable is that this table is a 24-hour TTL cache, pruned by
-- the `idempotency.prune` job, so its entire contents are disposable and its
-- steady state is one day of mutations. This file turns that from a claim in a
-- comment into a precondition the database checks:
--
--   1. Delete everything already expired. On a live database this is most of
--      the table; on a fresh one it is a no-op.
--   2. Refuse to continue if what remains is large enough that the rewrite
--      would hold ACCESS EXCLUSIVE for a noticeable time.
--
-- A migration that fails here has not broken anything: 0021 has not run, the
-- schema is unchanged, and the operator prunes further or picks a window. That
-- is the outcome we want from a guard — a loud stop, not a silent outage
-- (R-FAIL-01).
--
-- The DELETE is the only data change in task 9's migrations and it is bounded
-- by the expiry index (`idempotency_keys_expires_at_idx`), so it is an index
-- scan over dead keys rather than a sequential scan of the table.

DELETE FROM idempotency_keys WHERE expires_at < now();

DO $$
DECLARE
  remaining bigint;
  threshold constant bigint := 50000;
BEGIN
  SELECT count(*) INTO remaining FROM idempotency_keys;

  IF remaining > threshold THEN
    RAISE EXCEPTION
      'idempotency_keys still holds % live rows (limit %). Migration 0021 rewrites this table under ACCESS EXCLUSIVE, which blocks every mutation the API serves. Prune further or run this deploy in a maintenance window.',
      remaining, threshold;
  END IF;
END $$;
