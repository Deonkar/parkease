-- 0004_spaces_spatial.sql — hand-written
-- Geography column and GiST indexes that drizzle-kit cannot generate.

ALTER TABLE spaces
  ADD COLUMN location geography(Point,4326) NOT NULL
  DEFAULT 'SRID=4326;POINT(0 0)'::geography;

ALTER TABLE spaces ALTER COLUMN location DROP DEFAULT;

CREATE INDEX spaces_location_gix ON spaces USING gist (location);

CREATE INDEX spaces_active_location_gix
  ON spaces USING gist (location)
  WHERE approval_status = 'active' AND deleted_at IS NULL;
