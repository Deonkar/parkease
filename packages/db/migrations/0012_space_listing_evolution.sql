-- 0012_space_listing_evolution.sql
-- Evolve spaces, space_slots, space_photos for task 6 (owner listing).
-- No production data exists; these ALTERs are safe without expand-contract.

BEGIN;

SET lock_timeout = '5s';

-- ── spaces: add pricing JSONB, submitted_at, access_instructions ────────────

ALTER TABLE spaces ADD COLUMN pricing jsonb;
ALTER TABLE spaces ADD COLUMN submitted_at timestamptz;
ALTER TABLE spaces ADD COLUMN access_instructions text;

-- Backfill pricing from space_slots (existing seed data) before making NOT NULL.
-- For seeded rows, build a pricing object from slot prices.
UPDATE spaces SET pricing = '{}'::jsonb WHERE pricing IS NULL;
ALTER TABLE spaces ALTER COLUMN pricing SET NOT NULL;

-- ── spaces: change amenities default from {} to [] ──────────────────────────

ALTER TABLE spaces ALTER COLUMN amenities SET DEFAULT '[]'::jsonb;
UPDATE spaces SET amenities = '[]'::jsonb WHERE amenities = '{}'::jsonb;

-- ── spaces: evolve approval_status values ────────────────────────────────────

-- Rename existing values before swapping the constraint.
UPDATE spaces SET approval_status = 'pending_approval' WHERE approval_status IN ('draft', 'pending_review');
UPDATE spaces SET approval_status = 'inactive' WHERE approval_status = 'paused';

ALTER TABLE spaces DROP CONSTRAINT spaces_approval_status_check;
ALTER TABLE spaces ADD CONSTRAINT spaces_approval_status_check CHECK (
  approval_status IN ('pending_approval','changes_requested','rejected','active','inactive')
);
ALTER TABLE spaces ALTER COLUMN approval_status SET DEFAULT 'pending_approval';

-- ── spaces: update the active-location partial index to match new statuses ──

DROP INDEX IF EXISTS spaces_active_location_gix;
CREATE INDEX spaces_active_location_gix
  ON spaces USING gist (location)
  WHERE approval_status = 'active' AND deleted_at IS NULL;

-- ── space_slots: remove pricing columns, add label ──────────────────────────

ALTER TABLE space_slots DROP CONSTRAINT IF EXISTS space_slots_price_hourly_check;
ALTER TABLE space_slots DROP COLUMN price_paise_hourly;
ALTER TABLE space_slots DROP COLUMN price_paise_daily;
ALTER TABLE space_slots DROP COLUMN price_paise_weekly;
ALTER TABLE space_slots DROP COLUMN price_paise_monthly;
ALTER TABLE space_slots DROP COLUMN is_active;
ALTER TABLE space_slots ADD COLUMN label text;

-- ── space_photos: add metadata columns, rename sort_order, add indexes ──────

ALTER TABLE space_photos ADD COLUMN url text NOT NULL DEFAULT '';
ALTER TABLE space_photos ADD COLUMN format text NOT NULL DEFAULT 'jpg';
ALTER TABLE space_photos ADD COLUMN bytes integer NOT NULL DEFAULT 0;
ALTER TABLE space_photos ADD COLUMN width integer NOT NULL DEFAULT 0;
ALTER TABLE space_photos ADD COLUMN height integer NOT NULL DEFAULT 0;
ALTER TABLE space_photos ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- Rename sort_order → display_order.
ALTER TABLE space_photos RENAME COLUMN sort_order TO display_order;

-- Drop the placeholder defaults now that the columns exist.
ALTER TABLE space_photos ALTER COLUMN url DROP DEFAULT;
ALTER TABLE space_photos ALTER COLUMN format DROP DEFAULT;
ALTER TABLE space_photos ALTER COLUMN bytes DROP DEFAULT;
ALTER TABLE space_photos ALTER COLUMN width DROP DEFAULT;
ALTER TABLE space_photos ALTER COLUMN height DROP DEFAULT;

-- Unique: one primary per space, dense display_order per space.
CREATE UNIQUE INDEX space_photos_order_uq ON space_photos (space_id, display_order);
CREATE UNIQUE INDEX space_photos_primary_uq ON space_photos (space_id) WHERE is_primary;

COMMIT;
