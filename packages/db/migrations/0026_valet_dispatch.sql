-- 0026_valet_dispatch.sql — hand-written
-- Task 11. Grows the two placeholder valet tables 0008 declared into the ones
-- dispatch, tracking and the two-leg charge actually need, and adds the offer
-- table that makes "who was asked, and did they answer" a query.
--
-- WHY DROPS AND NOT-NULL ADDS ARE SAFE HERE, AND WOULD NOT BE ANYWHERE ELSE.
--
-- 0008 created valet_profiles and valet_jobs speculatively, as part of the bulk
-- schema task, against a design with no geography, no rating, no offer round,
-- no return leg and no commission. Nothing has ever written to either table:
-- there is no service, command, job, query or seed referencing them anywhere in
-- the repo, which `git grep -n 'valet_jobs\|valet_profiles'` confirms across
-- apps/ and packages/. The only reader is enum-drift.integration.test, which
-- inspects CHECK constraints and never selects a row. Both tables are empty in
-- every environment, including production, where tasks 9 and 10 shipped without
-- touching them.
--
-- That emptiness is the load-bearing claim, and `git grep` is evidence about
-- the code, not about the database. So it is asserted rather than assumed: the
-- guard below fails the migration if either table has acquired a row, and the
-- NOT NULL adds that follow are safe only because it passed. 0020 and 0024 set
-- this precedent.
--
-- FORWARD-ONLY. Migrations are immutable and there is no down file. If this
-- needs undoing after it commits, the recovery is 0008's two CREATE TABLEs and
-- 0011's two triggers; nothing else referenced these tables. Before it commits
-- there is nothing to recover — migrate.ts runs each file through a single
-- `sql.unsafe`, which Postgres wraps in one implicit transaction, so a failure
-- anywhere in this file rolls all of it back.
--
-- LOCKS. Every statement here takes ACCESS EXCLUSIVE on an empty, unreferenced
-- table, acquired and released in microseconds. migrate.ts sets lock_timeout to
-- 5s on the connection, so an unexpectedly busy table fails fast and loudly
-- rather than queueing every reader behind it. No CREATE INDEX CONCURRENTLY is
-- used or needed: a plain CREATE INDEX on an empty table is instant, and
-- CONCURRENTLY cannot run inside the transaction this file executes in.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM valet_jobs) OR EXISTS (SELECT 1 FROM valet_profiles) THEN
    RAISE EXCEPTION
      'Refusing to run 0026: valet_jobs or valet_profiles has rows. This migration '
      'adds NOT NULL columns with no backfill and drops columns, both of which '
      'assume the tables are empty. Write an expand-contract migration instead.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- valet_profiles — a dispatchable partner
-- ---------------------------------------------------------------------------

-- is_available was `text NOT NULL DEFAULT 'false'`: a boolean stored as a
-- string, which no query could index usefully and every reader would have had
-- to compare against the literal 'false'. Replaced, not renamed.
ALTER TABLE valet_profiles DROP COLUMN is_available;

ALTER TABLE valet_profiles
  ADD COLUMN licence_expires_at      timestamptz,
  ADD COLUMN background_check_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN is_online               boolean NOT NULL DEFAULT false,
  ADD COLUMN last_seen_at            timestamptz,
  ADD COLUMN current_location        geography(Point,4326),
  ADD COLUMN vehicle_make            text,
  ADD COLUMN vehicle_number          text,
  ADD COLUMN rating_avg_bp           integer,
  ADD COLUMN rating_count            integer NOT NULL DEFAULT 0;

ALTER TABLE valet_profiles
  ADD CONSTRAINT valet_profiles_background_check_status_check
    CHECK (background_check_status IN ('pending','passed','failed')),
  -- Mirrors the spaces rating invariant task 17 defines: rating_avg_bp is NULL
  -- exactly when there are no reviews, so "unrated" is one state rather than two
  -- that look alike. A NOT NULL DEFAULT 0 here is how a product ends up showing
  -- a brand-new partner as 0.0 stars and starving them of the jobs that would
  -- rate them.
  ADD CONSTRAINT valet_profiles_rating_check
    CHECK ((rating_count = 0 AND rating_avg_bp IS NULL)
        OR (rating_count > 0 AND rating_avg_bp BETWEEN 10000 AND 50000)),
  ADD CONSTRAINT valet_profiles_rating_count_check CHECK (rating_count >= 0);

-- One profile per user. 0008 created a plain index, which does not say that.
DROP INDEX valet_profiles_user_id_idx;
CREATE UNIQUE INDEX valet_profiles_user_id_key ON valet_profiles (user_id);

-- The index the candidate search lives or dies on. Without it every dispatch is
-- a sequential scan over every valet in the country (R-PERF-01).
--
-- Partial, following spaces_active_location_gix in 0004. A valet who has never
-- sent a fix has current_location NULL and can never be a candidate — the
-- assignment query requires the column to be non-null — so indexing those rows
-- adds entries that no ST_DWithin can ever return. The predicate is also stable:
-- a location is set on the first heartbeat and updated thereafter, never nulled
-- back, so rows enter this index once and do not churn in and out of it.
CREATE INDEX valet_profiles_current_location_gix
  ON valet_profiles USING gist (current_location)
  WHERE current_location IS NOT NULL;

-- ---------------------------------------------------------------------------
-- valet_jobs — one car, one custodian, at every moment
-- ---------------------------------------------------------------------------

-- Superseded by proof_photo_id: §11 has one photo, taken at confirm_parked, and
-- the server refuses that transition without it. Two nullable photo columns
-- nobody writes are not a feature.
ALTER TABLE valet_jobs
  DROP COLUMN pickup_photo_id,
  DROP COLUMN dropoff_photo_id;

ALTER TABLE valet_jobs
  ADD COLUMN driver_user_id       uuid NOT NULL REFERENCES users (id),
  ADD COLUMN pickup_location      geography(Point,4326) NOT NULL,
  ADD COLUMN pickup_address       text NOT NULL,
  ADD COLUMN arrived_at           timestamptz,
  ADD COLUMN parked_at            timestamptz,
  ADD COLUMN offer_radius_m       integer NOT NULL DEFAULT 5000,
  ADD COLUMN offer_round          integer NOT NULL DEFAULT 0,
  -- Frozen at accept time so a later rate change cannot restate a settled job
  -- (R-MONEY-03). numeric, not float: 0.200 is exact and 0.2 as a float is not.
  ADD COLUMN commission_rate      numeric(4,3) NOT NULL,
  ADD COLUMN txn_id               uuid,
  ADD COLUMN return_requested_at  timestamptz,
  ADD COLUMN return_distance_m    integer,
  ADD COLUMN return_fee_paise     bigint,
  ADD COLUMN return_txn_id        uuid,
  ADD COLUMN return_drop_location geography(Point,4326),
  ADD COLUMN proof_photo_id       text,
  ADD COLUMN cancellation_reason  text;

ALTER TABLE valet_jobs
  ADD CONSTRAINT valet_jobs_fee_paise_check
    CHECK (fee_paise IS NULL OR fee_paise >= 0),
  ADD CONSTRAINT valet_jobs_return_fee_paise_check
    CHECK (return_fee_paise IS NULL OR return_fee_paise >= 0),
  ADD CONSTRAINT valet_jobs_distance_check
    CHECK ((distance_m IS NULL OR distance_m >= 0)
       AND (return_distance_m IS NULL OR return_distance_m >= 0)),
  ADD CONSTRAINT valet_jobs_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1),
  ADD CONSTRAINT valet_jobs_offer_round_check  CHECK (offer_round >= 0),
  ADD CONSTRAINT valet_jobs_offer_radius_check CHECK (offer_radius_m > 0),
  -- The candidate query excludes the driver from their own offer set. A row
  -- that violates this means the exclusion was bypassed.
  ADD CONSTRAINT valet_jobs_assignee_is_not_driver_check
    CHECK (assigned_user_id IS NULL OR assigned_user_id <> driver_user_id),
  -- The invariant the first-accept-wins UPDATE leans on: before `accepted` a job
  -- has no assignee, and from `accepted` through `completed` it has exactly one.
  -- The database enforces it because "two valets, one job" is the failure this
  -- whole task exists to make unreachable, and the application cannot be trusted
  -- with it (R-DB-05).
  --
  -- Deliberately NOT named `..._status_check`: enum-drift.integration.test finds
  -- the valet job status enum with `conname LIKE '%status_check%'` and unions the
  -- literals out of everything that matches, so a second constraint naming
  -- statuses would silently widen what that test believes the enum to be.
  ADD CONSTRAINT valet_jobs_assignee_presence_check
    CHECK ((status IN ('requested','offered') AND assigned_user_id IS NULL)
        OR (status IN ('accepted','en_route','arrived','parking','parked',
                       'return_requested','returning','completed')
            AND assigned_user_id IS NOT NULL)
        OR status IN ('cancelled','no_show'));

CREATE INDEX valet_jobs_driver_user_id_idx ON valet_jobs (driver_user_id);

-- ---------------------------------------------------------------------------
-- valet_job_offers — who was asked, and did they answer
-- ---------------------------------------------------------------------------

CREATE TABLE valet_job_offers (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  job_id            uuid NOT NULL REFERENCES valet_jobs (id) ON DELETE CASCADE,
  valet_user_id     uuid NOT NULL REFERENCES users (id),
  distance_m        integer NOT NULL,
  rating_at_offer_bp integer,
  offer_round       integer NOT NULL DEFAULT 0,
  offered_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  outcome           text NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valet_job_offers_outcome_check
    CHECK (outcome IN ('pending','won','lost','declined','expired')),
  CONSTRAINT valet_job_offers_distance_check CHECK (distance_m >= 0),
  CONSTRAINT valet_job_offers_rating_check
    CHECK (rating_at_offer_bp IS NULL OR rating_at_offer_bp BETWEEN 10000 AND 50000)
);

-- One offer per valet per job. This is the candidate query's NOT EXISTS guard
-- made unbypassable: a widened round cannot re-offer to someone who already saw
-- this job, even if the query is wrong.
CREATE UNIQUE INDEX valet_job_offers_job_valet_key
  ON valet_job_offers (job_id, valet_user_id);

CREATE INDEX valet_job_offers_job_id_idx        ON valet_job_offers (job_id);
CREATE INDEX valet_job_offers_valet_user_id_idx ON valet_job_offers (valet_user_id);

-- 0011's convention: updated_at is trigger-maintained so a raw SQL fix in a
-- console cannot leave a stale timestamp.
CREATE TRIGGER trg_valet_job_offers_updated_at
  BEFORE UPDATE ON valet_job_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
