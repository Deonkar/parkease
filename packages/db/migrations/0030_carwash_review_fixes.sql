-- 0030_carwash_review_fixes.sql — hand-written
-- Task 13, from the database review lens. Three changes to the car wash tables
-- 0027 created, none of which change what the application does today.
--
-- Migrations are immutable, so these are a new file rather than an edit to
-- 0027. All three tables are still empty — nothing has written to them outside
-- Testcontainers — so every statement here takes ACCESS EXCLUSIVE on an empty
-- table for microseconds, behind migrate.ts's 5s lock_timeout.
--
-- FORWARD-ONLY. The recovery is to re-add the dropped index and drop the two
-- constraints added below; nothing here loses data.

-- ---------------------------------------------------------------------------
-- 1. The assignee presence check also guards txn_id
-- ---------------------------------------------------------------------------
--
-- 0027 required a partner and a price from `accepted` onward but said nothing
-- about `txn_id`, even though `accept-wash.command.ts` writes all three in the
-- same UPDATE for a stated reason: a job with a partner but no receivable is
-- somebody working for free, and there is no later moment at which both facts
-- become true together.
--
-- So the constraint enforced two thirds of an invariant the code treats as
-- atomic. A backfill, an admin console UPDATE or a future second write path
-- could set the status, the partner and the price and forget the ledger link —
-- producing a job that reads as fully assigned with no `owner_payable` posting
-- anywhere, which is precisely the failure rule 5 exists to make unreachable.
--
-- Replaced rather than added to: two constraints covering overlapping parts of
-- one invariant is how the weaker one ends up being the one people read.
ALTER TABLE wash_jobs DROP CONSTRAINT wash_jobs_assignee_presence_check;

ALTER TABLE wash_jobs
  ADD CONSTRAINT wash_jobs_assignee_presence_check
    CHECK ((status IN ('requested','offered')
            AND washer_user_id IS NULL AND price_paise IS NULL AND txn_id IS NULL)
        OR (status IN ('accepted','en_route','washing','completed')
            AND washer_user_id IS NOT NULL AND price_paise IS NOT NULL
            AND txn_id IS NOT NULL)
        OR status = 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. The busy-partner exclusion gets an index that scales with live jobs
-- ---------------------------------------------------------------------------
--
-- The candidate query asks, once per nearby partner on every dispatch and on
-- every widened round:
--
--   NOT EXISTS (SELECT 1 FROM wash_jobs
--               WHERE washer_user_id = ? AND status NOT IN ('completed','cancelled'))
--
-- `wash_jobs_washer_user_id_idx` covers only the equality. The status filter is
-- then a heap recheck over *every job that partner has ever done*, so the cost
-- of asking "are they busy right now" grows with their career rather than with
-- the answer. A partner six months in pays for six months of history on every
-- dispatch that passes near them.
--
-- Partial, on the same reasoning as `washer_profiles_current_location_gix`: the
-- predicate is exactly the rows the query wants, so completed and cancelled
-- jobs never enter the index at all. It stays small permanently — a live job is
-- a transient state — which is the property the plain index does not have.
CREATE INDEX wash_jobs_washer_live_idx
  ON wash_jobs (washer_user_id)
  WHERE status NOT IN ('completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- 3. Drop the offer index that duplicates a prefix of the unique key
-- ---------------------------------------------------------------------------
--
-- `wash_job_offers_job_washer_key` is UNIQUE (job_id, washer_user_id), so
-- Postgres already serves `WHERE job_id = ?` from its leading column.
-- `wash_job_offers_job_id_idx` therefore covers nothing the composite does not,
-- and costs a second B-tree to maintain on every offer row written — three per
-- job at the current fan-out, on every dispatch and every widened round.
--
-- Ported from 0026's valet shape without the question being asked. Dropped here
-- rather than left as harmless: an index nobody can name a query for is one
-- somebody will preserve out of caution during the next schema change.
DROP INDEX wash_job_offers_job_id_idx;
