-- 0027_carwash_dispatch.sql — hand-written
-- Task 13. Grows the three placeholder car wash tables 0008 declared into the
-- ones dispatch, a two-row service menu and a settled job actually need, adds
-- the offer table that makes "who was asked, and did they answer" a query, and
-- teaches `payments` the difference between a parking booking and a wash.
--
-- WHY DROPS AND NOT-NULL ADDS ARE SAFE HERE, AND WOULD NOT BE ANYWHERE ELSE.
--
-- 0008 created washer_profiles, wash_services and wash_jobs speculatively, as
-- part of the bulk schema task, against a design with no geography, no rating,
-- no partner type, no offer round and no frozen commission. Nothing has ever
-- written to any of them: there is no service, command, job, query or seed
-- referencing them anywhere in the repo, which
-- `git grep -n 'wash_jobs\|wash_services\|washer_profiles'` confirms across
-- apps/ and packages/. The only reader is enum-drift.integration.test, which
-- inspects CHECK constraints and never selects a row. All three are empty in
-- every environment.
--
-- That emptiness is the load-bearing claim, and `git grep` is evidence about
-- the code, not about the database. So it is asserted rather than assumed: the
-- guard below fails the migration if any of the three has acquired a row, and
-- the drops and NOT NULL adds that follow are safe only because it passed.
-- 0020, 0024 and 0026 set this precedent.
--
-- The `payments` changes at the end are a different case, and are written to be
-- safe on a table that DOES have rows — see the heading there.
--
-- FORWARD-ONLY. Migrations are immutable and there is no down file. If this
-- needs undoing after it commits, the recovery is 0008's three CREATE TABLEs
-- and 0011's three triggers; nothing else referenced these tables. Before it
-- commits there is nothing to recover — migrate.ts runs each file through a
-- single `sql.unsafe`, which Postgres wraps in one implicit transaction, so a
-- failure anywhere in this file rolls all of it back.
--
-- LOCKS. Every statement against a wash table takes ACCESS EXCLUSIVE on an
-- empty, unreferenced table, acquired and released in microseconds. migrate.ts
-- sets lock_timeout to 5s on the connection, so an unexpectedly busy table
-- fails fast and loudly rather than queueing every reader behind it. No CREATE
-- INDEX CONCURRENTLY is used or needed: a plain CREATE INDEX on an empty table
-- is instant, and CONCURRENTLY cannot run inside the transaction this file
-- executes in.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wash_jobs)
     OR EXISTS (SELECT 1 FROM wash_services)
     OR EXISTS (SELECT 1 FROM washer_profiles) THEN
    RAISE EXCEPTION
      'Refusing to run 0027: wash_jobs, wash_services or washer_profiles has rows. '
      'This migration adds NOT NULL columns with no backfill and drops columns, '
      'both of which assume the tables are empty. Write an expand-contract '
      'migration instead.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- washer_profiles — a dispatchable partner, business or gig
-- ---------------------------------------------------------------------------

-- is_available was `text NOT NULL DEFAULT 'false'`: a boolean stored as a
-- string, which no query could index usefully and every reader would have had
-- to compare against the literal 'false'. Replaced, not renamed — same call
-- 0026 made on the valet twin.
ALTER TABLE washer_profiles DROP COLUMN is_available;

ALTER TABLE washer_profiles
  -- §13.10. A registered outfit and an individual both land here and take the
  -- same assignment path; the discriminator says what they must supply, not
  -- what they become. No default: a partner type is a decision at registration,
  -- and defaulting it would silently make every unmigrated caller a 'gig'.
  ADD COLUMN partner_type       text NOT NULL,
  ADD COLUMN business_name      text,
  ADD COLUMN gstin              text,
  -- Upload ids, never URLs or bytes. Files go through POST /uploads, which
  -- validates magic bytes rather than trusting a content type (R-VAL-01).
  ADD COLUMN business_photo_ids text[] NOT NULL DEFAULT '{}',
  -- jsonb rather than seven column pairs or a child table: "what are Monday's
  -- hours" is the only question anything asks of it, and a weekday added later
  -- is then not a migration.
  ADD COLUMN operating_hours    jsonb,
  ADD COLUMN capabilities       text[] NOT NULL DEFAULT '{}',
  -- An image an admin looks at. security.md §5.3: the Aadhaar *number* is never
  -- collected, and there is deliberately no column that could hold one.
  ADD COLUMN id_document_id     text,
  -- What the partner last chose. On its own it means "willing", not
  -- "reachable" — a phone that lost connectivity keeps this true — so the
  -- assignment query always pairs it with the last_seen_at heartbeat.
  ADD COLUMN is_online          boolean NOT NULL DEFAULT false,
  ADD COLUMN last_seen_at       timestamptz,
  ADD COLUMN current_location   geography(Point,4326),
  ADD COLUMN rating_avg_bp      integer,
  ADD COLUMN rating_count       integer NOT NULL DEFAULT 0;

ALTER TABLE washer_profiles
  ADD CONSTRAINT washer_profiles_partner_type_check
    CHECK (partner_type IN ('business','gig')),
  -- A business with no name is a row nobody can render on a driver's job card.
  -- The contract refuses it too; this is the half that cannot be bypassed by a
  -- direct write.
  ADD CONSTRAINT washer_profiles_business_name_check
    CHECK (partner_type <> 'business' OR business_name IS NOT NULL),
  -- Mirrors the spaces rating invariant task 17 defines, and the valet one in
  -- 0026: rating_avg_bp is NULL exactly when there are no reviews, so "unrated"
  -- is one state rather than two that look alike. A NOT NULL DEFAULT 0 here is
  -- how a product ends up showing a brand-new partner as 0.0 stars and starving
  -- them of the jobs that would rate them.
  ADD CONSTRAINT washer_profiles_rating_check
    CHECK ((rating_count = 0 AND rating_avg_bp IS NULL)
        OR (rating_count > 0 AND rating_avg_bp BETWEEN 10000 AND 50000)),
  ADD CONSTRAINT washer_profiles_rating_count_check CHECK (rating_count >= 0);

-- One profile per user. 0008 created a plain index, which does not say that.
DROP INDEX washer_profiles_user_id_idx;
CREATE UNIQUE INDEX washer_profiles_user_id_key ON washer_profiles (user_id);

-- The index the candidate search lives or dies on. Without it every dispatch is
-- a sequential scan over every partner in the country (R-PERF-01).
--
-- Partial, following spaces_active_location_gix in 0004 and the valet index in
-- 0026. A partner who has never sent a fix has current_location NULL and can
-- never be a candidate — the assignment query requires the column to be
-- non-null — so indexing those rows adds entries that no ST_DWithin can ever
-- return. The predicate is also stable: a location is set on the first
-- heartbeat and updated thereafter, never nulled back, so rows enter this index
-- once and do not churn in and out of it.
CREATE INDEX washer_profiles_current_location_gix
  ON washer_profiles USING gist (current_location)
  WHERE current_location IS NOT NULL;

-- ---------------------------------------------------------------------------
-- wash_services — two rows per service, one per vehicle type
-- ---------------------------------------------------------------------------

-- §13.3 and the v1 bug it exists to close. v1 stored one `price` beside a
-- `vehicle_type` that could be 'car', 'two_wheeler' or 'BOTH'. A query for
-- "what does a Premium Wash cost for a bike" against a BOTH row required the
-- caller to know that BOTH meant "use this for either", which no caller did —
-- and a partner charging ₹399 for a car and ₹149 for a bike had no way to say
-- so. Two rows and a unique key resolve it by schema rather than by convention.

ALTER TABLE wash_services RENAME COLUMN user_id TO washer_user_id;
ALTER TABLE wash_services RENAME COLUMN name    TO service_name;

ALTER INDEX wash_services_user_id_idx RENAME TO wash_services_washer_user_id_idx;

-- is_active was text holding 'true'/'false', same mistake as is_available.
ALTER TABLE wash_services DROP COLUMN is_active;
ALTER TABLE wash_services ADD COLUMN is_active boolean NOT NULL DEFAULT true;

ALTER TABLE wash_services
  -- The v1 catalogue is closed: a partner sets prices but does not invent
  -- services (§13.3). A CHECK rather than free text is what lets the assignment
  -- query ask "does this partner offer *this* service" as an equality, and what
  -- stops two partners spelling the same wash three ways.
  ADD CONSTRAINT wash_services_service_name_check
    CHECK (service_name IN (
      'basic_exterior','premium_wash','interior_only','full_detailing','quick_wipe'
    )),
  -- THE constraint this table exists for. It makes vehicle_type = 'both'
  -- unrepresentable rather than merely discouraged: there is nowhere to put it
  -- that does not collide with one of the two real rows.
  ADD CONSTRAINT wash_services_menu_key
    UNIQUE (washer_user_id, service_name, vehicle_type);

-- 0008's `price_paise > 0` is kept deliberately, against the task file's
-- `>= 0`. A zero-price service prices to a zero commission, zero GST and a zero
-- driver total; leg() in money/ledger-entries.ts drops zero-amount entries
-- because ledger_entries_amount_check is `amount_paise > 0`, so accept would
-- compose an empty posting and assertEntriesBalance rejects an empty posting
-- outright. A free wash would be a 500, not a promotion.

-- ---------------------------------------------------------------------------
-- wash_jobs — one car, one partner, one frozen price
-- ---------------------------------------------------------------------------

-- The service is denormalised onto the job and the FK to the menu row is
-- dropped. A menu row is mutable — a partner can re-price Premium Wash
-- tomorrow — and a settled job that reads its price through a foreign key is a
-- job whose history changes under it (R-MONEY-03). What the partner charged and
-- what rate we took are facts about that job, frozen at accept.
-- Dropping the column drops wash_jobs_wash_service_id_idx with it; naming the
-- index separately would only add a NOTICE saying it had already gone.
ALTER TABLE wash_jobs DROP COLUMN wash_service_id;

-- fee_paise is replaced by price_paise, which is the number that matters: what
-- the partner charges. The fee, the commission, the GST and the driver's total
-- are all derived from it by computeWashFee at the rate frozen beside it.
ALTER TABLE wash_jobs DROP COLUMN fee_paise;

ALTER TABLE wash_jobs RENAME COLUMN assigned_user_id TO washer_user_id;
ALTER INDEX wash_jobs_assigned_user_id_idx RENAME TO wash_jobs_washer_user_id_idx;

-- A wash without a booking is a wash of no particular car. 0008 left this
-- nullable; nothing ever wrote a row, so tightening it needs no backfill.
ALTER TABLE wash_jobs ALTER COLUMN booking_id SET NOT NULL;

ALTER TABLE wash_jobs
  ADD COLUMN service_name        text NOT NULL,
  ADD COLUMN vehicle_type        text NOT NULL,
  -- Where the car is. The partner travels to the space, not to the driver's
  -- current position — the car is parked and staying, which is the whole
  -- precondition for the feature.
  ADD COLUMN space_location      geography(Point,4326) NOT NULL,
  -- NULL until somebody accepts. Nobody has consulted a menu before that, so
  -- there is no price to show and a 0 would be telling the driver something
  -- untrue.
  ADD COLUMN price_paise         bigint,
  -- Frozen at accept so a later rate change cannot restate a settled job
  -- (R-MONEY-03). numeric, not float: 0.200 is exact and 0.2 as a float is not.
  ADD COLUMN commission_rate     numeric(4,3) NOT NULL,
  ADD COLUMN offer_radius_m      integer NOT NULL DEFAULT 3000,
  ADD COLUMN offer_round         integer NOT NULL DEFAULT 0,
  ADD COLUMN started_at          timestamptz,
  ADD COLUMN txn_id              uuid,
  ADD COLUMN cancellation_reason text;

ALTER TABLE wash_jobs
  ADD CONSTRAINT wash_jobs_service_name_check
    CHECK (service_name IN (
      'basic_exterior','premium_wash','interior_only','full_detailing','quick_wipe'
    )),
  ADD CONSTRAINT wash_jobs_vehicle_type_check
    CHECK (vehicle_type IN ('car','two_wheeler')),
  ADD CONSTRAINT wash_jobs_price_paise_check
    CHECK (price_paise IS NULL OR price_paise > 0),
  ADD CONSTRAINT wash_jobs_commission_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 1),
  ADD CONSTRAINT wash_jobs_offer_round_check  CHECK (offer_round >= 0),
  ADD CONSTRAINT wash_jobs_offer_radius_check CHECK (offer_radius_m > 0),
  -- The candidate query excludes the driver from their own offer set. A row
  -- that violates this means the exclusion was bypassed.
  ADD CONSTRAINT wash_jobs_washer_is_not_driver_check
    CHECK (washer_user_id IS NULL OR washer_user_id <> driver_user_id),
  -- The invariant the first-accept-wins UPDATE leans on: before `accepted` a
  -- job has no partner, and from `accepted` through `completed` it has exactly
  -- one, with a price. The database enforces it because "two partners, one job"
  -- is the failure the conditional UPDATE exists to make unreachable, and the
  -- application cannot be trusted with it (R-DB-05).
  --
  -- `cancelled` is unconstrained: it is reachable from a state with a partner
  -- and from one without.
  --
  -- Deliberately NOT named `..._status_check`: enum-drift.integration.test
  -- finds the wash job status enum with `conname LIKE '%status_check%'` and
  -- unions the literals out of everything that matches, so a second constraint
  -- naming statuses would silently widen what that test believes the enum to
  -- be. The valet side hit exactly this in 0026.
  ADD CONSTRAINT wash_jobs_assignee_presence_check
    CHECK ((status IN ('requested','offered')
            AND washer_user_id IS NULL AND price_paise IS NULL)
        OR (status IN ('accepted','en_route','washing','completed')
            AND washer_user_id IS NOT NULL AND price_paise IS NOT NULL)
        OR status = 'cancelled'),
  -- §13.8, the server-side half of the photo gates. The command refuses the
  -- transition without the photo; this refuses the *row* without it, so a
  -- direct write cannot produce a completed wash with no evidence that it
  -- happened.
  ADD CONSTRAINT wash_jobs_photo_gate_check
    CHECK ((status <> 'washing'   OR before_photo_id IS NOT NULL)
       AND (status <> 'completed' OR (before_photo_id IS NOT NULL
                                  AND after_photo_id IS NOT NULL)));

-- ---------------------------------------------------------------------------
-- wash_job_offers — who was asked, and did they answer
-- ---------------------------------------------------------------------------
--
-- A table rather than an inference from logs, for two reasons: the radius
-- expansion needs "has this partner already seen this job" as a NOT EXISTS, and
-- "why did nobody take it" is an operational question somebody will ask.

CREATE TABLE wash_job_offers (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  job_id             uuid NOT NULL REFERENCES wash_jobs (id) ON DELETE CASCADE,
  washer_user_id     uuid NOT NULL REFERENCES users (id),
  distance_m         integer NOT NULL,
  -- The rating as it stood when the offer went out. NULL means unrated.
  rating_at_offer_bp integer,
  offer_round        integer NOT NULL DEFAULT 0,
  offered_at         timestamptz NOT NULL DEFAULT now(),
  responded_at       timestamptz,
  outcome            text NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wash_job_offers_outcome_check
    CHECK (outcome IN ('pending','won','lost','declined','expired')),
  CONSTRAINT wash_job_offers_distance_check CHECK (distance_m >= 0),
  CONSTRAINT wash_job_offers_rating_check
    CHECK (rating_at_offer_bp IS NULL OR rating_at_offer_bp BETWEEN 10000 AND 50000)
);

-- One offer per partner per job. This is the candidate query's NOT EXISTS guard
-- made unbypassable: a widened round cannot re-offer to somebody who already saw
-- this job, even if the query is wrong.
CREATE UNIQUE INDEX wash_job_offers_job_washer_key
  ON wash_job_offers (job_id, washer_user_id);

CREATE INDEX wash_job_offers_job_id_idx         ON wash_job_offers (job_id);
CREATE INDEX wash_job_offers_washer_user_id_idx ON wash_job_offers (washer_user_id);

-- 0011's convention: updated_at is trigger-maintained so a raw SQL fix in a
-- console cannot leave a stale timestamp.
CREATE TRIGGER trg_wash_job_offers_updated_at
  BEFORE UPDATE ON wash_job_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- payments — which thing this order is for
-- ---------------------------------------------------------------------------
--
-- THIS TABLE IS NOT EMPTY, AND THESE STATEMENTS ARE WRITTEN FOR THAT.
--
-- §13.4: a wash is an add-on requested after the booking is already paid, at a
-- price that depends on the winning partner's menu, so it cannot be a line item
-- on the original order and gets a Razorpay order of its own.
--
-- That order hangs off the same booking, which is the problem. payments.booking_id
-- is NOT NULL and PaymentService.findOpenForBooking(bookingId) selects on
-- booking_id plus status = 'created'. Without a discriminator, a driver
-- reopening Checkout for their *parking* booking would be handed the car wash
-- order — the right gateway id for the wrong thing, at the wrong amount.
--
-- Safe on a populated table: PG 11+ stores a non-volatile column default in the
-- catalogue and does not rewrite the heap, so the ADD COLUMN is a metadata-only
-- change that takes ACCESS EXCLUSIVE for microseconds. The default is also
-- *correct* for every existing row — every payment written before this
-- migration is a booking payment — so there is nothing to backfill.
ALTER TABLE payments
  ADD COLUMN purpose     text NOT NULL DEFAULT 'booking',
  ADD COLUMN wash_job_id uuid REFERENCES wash_jobs (id);

-- NOT VALID, following 0017 and 0019. On a populated table a one-step CHECK
-- scans every existing row while holding ACCESS EXCLUSIVE, which blocks reads
-- and writes for the length of the scan. NOT VALID is metadata-only: it takes
-- ACCESS EXCLUSIVE for microseconds, checks no existing row, and applies to
-- every row written from here on. 0028 proves the existing rows afterwards,
-- under SHARE UPDATE EXCLUSIVE, in its own file — the split only works because
-- no ACCESS EXCLUSIVE lock from this file is still held by then.
--
-- Validation cannot fail today: every row predates the column and therefore has
-- purpose = 'booking' and wash_job_id NULL. The two-step is used anyway,
-- because it is the shape that stays correct once payments is large.
ALTER TABLE payments
  ADD CONSTRAINT payments_purpose_check
    CHECK (purpose IN ('booking','carwash'))
    NOT VALID;

-- The two columns cannot disagree. A 'carwash' payment with no job is an order
-- nobody can reconcile, and a 'booking' payment carrying a job id is a
-- mislabelled row that every purpose-scoped query would then answer wrongly.
ALTER TABLE payments
  ADD CONSTRAINT payments_wash_job_coherence_check
    CHECK ((purpose = 'carwash' AND wash_job_id IS NOT NULL)
        OR (purpose = 'booking' AND wash_job_id IS NULL))
    NOT VALID;

-- The index on wash_job_id is NOT created here. payments takes writes, and a
-- plain CREATE INDEX blocks every one of them for the build — while
-- CONCURRENTLY cannot run inside the implicit transaction this file executes
-- in. It gets its own single-statement file, 0029, exactly as 0014 and 0015 do.
--
-- No (booking_id, purpose) composite either. findOpenForBooking filters on
-- both, but payments_booking_id_idx already narrows to the handful of rows one
-- booking has, and rechecking purpose across two or three rows is free. An
-- index earns its keep by what it eliminates, and that one eliminates nothing.
