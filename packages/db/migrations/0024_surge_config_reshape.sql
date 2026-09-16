-- 0024_surge_config_reshape.sql — hand-written
-- Task 10. Reshapes the two surge tables 0009 declared into the ones the
-- engine actually needs.
--
-- WHY A DROP IS SAFE HERE, AND WOULD NOT BE ANYWHERE ELSE IN THIS SCHEMA.
--
-- 0009 created `surge_config` and `surge_zone_overrides` speculatively, as part
-- of the bulk schema task, against a design that has since been superseded:
-- a single `demand_threshold` integer and one flat `base/max` multiplier pair,
-- with no tier ladder, no badge, no peak windows and no per-zone partial
-- override. Nothing has ever written to either table — there is no seed, no
-- service, no job and no query referencing them anywhere in the repo, which
-- `git grep surge_config` confirms across apps/ and packages/. They are empty
-- in every environment, including production, where task 9 shipped without
-- touching them.
--
-- An expand-contract dance over two provably-empty, provably-unread tables
-- would add three migrations and a fortnight of double-write code to preserve
-- zero rows. The honest operation is a replace, and it is stated as one.
--
-- Both DROPs take ACCESS EXCLUSIVE, which on an unreferenced empty table is
-- acquired and released in microseconds. `migrate.ts` sets lock_timeout to 5s
-- on the connection, so if either table is unexpectedly busy this fails fast
-- and loudly rather than queueing every reader behind it.
--
-- CASCADE is deliberately NOT used: if either table has acquired a dependent
-- object since 0009, this migration should fail and be read by a human rather
-- than silently dropping whatever that object was.

DROP TABLE IF EXISTS surge_zone_overrides;
DROP TABLE IF EXISTS surge_config;

-- One row, keyed 'global'. Read once per recalculation run, so there is no
-- module-level constant anywhere in domains/surge that can drift from it.
--
-- Multipliers and occupancy thresholds are integer basis points, matching
-- `bookings.surge_multiplier_bp`. The task file specifies numeric(4,2); this
-- schema keeps the representation the rest of the money path already uses,
-- because every tier boundary is an exact equality case and float comparison
-- at a tier edge is the exact class of unexplainable price task 10 exists to
-- remove.
CREATE TABLE surge_config (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  key text NOT NULL UNIQUE,
  max_multiplier_bp integer NOT NULL,
  peak_hour_modifier_bp integer NOT NULL,
  weekend_modifier_bp integer NOT NULL,
  event_modifier_bp integer NOT NULL,
  occupancy_window_minutes integer NOT NULL,
  peak_windows jsonb NOT NULL,
  tiers jsonb NOT NULL,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surge_config_max_check CHECK (max_multiplier_bp BETWEEN 10000 AND 50000),
  CONSTRAINT surge_config_peak_check CHECK (peak_hour_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_config_weekend_check CHECK (weekend_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_config_event_check CHECK (event_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_config_window_check CHECK (occupancy_window_minutes BETWEEN 5 AND 1440),
  CONSTRAINT surge_config_tiers_check CHECK (jsonb_typeof(tiers) = 'array'),
  CONSTRAINT surge_config_peak_windows_check CHECK (jsonb_typeof(peak_windows) = 'array')
);

-- A per-zone amendment. Every multiplier column is nullable so a zone can raise
-- its cap without restating the whole ladder; the application merges nulls down
-- to the global value.
--
-- zone_id is a geohash-6 cell and the CHECK enforces the alphabet, because a
-- zone id that is not a real cell would silently never match anything the
-- recalculation job writes — an override that appears saved and does nothing.
CREATE TABLE surge_zone_overrides (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  zone_id text NOT NULL UNIQUE,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  max_multiplier_bp integer,
  peak_hour_modifier_bp integer,
  weekend_modifier_bp integer,
  event_modifier_bp integer,
  tiers jsonb,
  reason text NOT NULL,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surge_zone_overrides_zone_id_check
    CHECK (zone_id ~ '^[0-9bcdefghjkmnpqrstuvwxyz]{6}$'),
  CONSTRAINT surge_zone_overrides_max_check
    CHECK (max_multiplier_bp IS NULL OR max_multiplier_bp BETWEEN 10000 AND 50000),
  CONSTRAINT surge_zone_overrides_peak_check
    CHECK (peak_hour_modifier_bp IS NULL OR peak_hour_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_zone_overrides_weekend_check
    CHECK (weekend_modifier_bp IS NULL OR weekend_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_zone_overrides_event_check
    CHECK (event_modifier_bp IS NULL OR event_modifier_bp BETWEEN 10000 AND 20000),
  CONSTRAINT surge_zone_overrides_tiers_check
    CHECK (tiers IS NULL OR jsonb_typeof(tiers) = 'array'),
  CONSTRAINT surge_zone_overrides_reason_check CHECK (length(btrim(reason)) > 0)
);

-- The recalculation job reads `WHERE enabled = true` once per run; the FK index
-- is here because Drizzle does not create them and every FK must have one.
CREATE INDEX surge_zone_overrides_enabled_idx ON surge_zone_overrides (enabled);
CREATE INDEX surge_zone_overrides_updated_by_idx ON surge_zone_overrides (updated_by);

-- DROP TABLE took the two updated_at triggers 0011 installed down with it.
-- Without these, an admin editing the config through the API would leave a
-- stale updated_at — and updated_at is what the audit trail is reconciled
-- against when someone asks who doubled prices in a zone and when.
CREATE TRIGGER trg_surge_config_updated_at
  BEFORE UPDATE ON surge_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_surge_zone_overrides_updated_at
  BEFORE UPDATE ON surge_zone_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The seed. prd.md §8's ladder, with the strictly-greater-than thresholds
-- pinned here rather than left to whoever writes the first test:
-- <=0.60 is 1.0x, >0.60 is 1.25x, >0.75 is 1.5x, >0.90 is 2.0x.
--
-- `ON CONFLICT DO NOTHING` keeps this idempotent: re-running the migration on a
-- database that already has the row is a no-op rather than a unique violation.
INSERT INTO surge_config (
  key, max_multiplier_bp, peak_hour_modifier_bp, weekend_modifier_bp,
  event_modifier_bp, occupancy_window_minutes, peak_windows, tiers
) VALUES (
  'global', 20000, 11000, 10500, 12000, 60,
  '[{"days":["mon","tue","wed","thu","fri"],"from":"08:00","to":"11:00"},
    {"days":["mon","tue","wed","thu","fri"],"from":"17:00","to":"21:00"}]'::jsonb,
  '[{"minOccupancyBp":0,"multiplierBp":10000,"badge":null},
    {"minOccupancyBp":6000,"multiplierBp":12500,"badge":"moderate_demand"},
    {"minOccupancyBp":7500,"multiplierBp":15000,"badge":"high_demand"},
    {"minOccupancyBp":9000,"multiplierBp":20000,"badge":"very_high_demand"}]'::jsonb
) ON CONFLICT (key) DO NOTHING;
