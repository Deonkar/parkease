-- 0014_spaces_amenities_gin.sql — hand-written
-- Backs `amenities @> '["covered","cctv"]'::jsonb` in the discovery query
-- (task 7). jsonb_path_ops is the smaller, faster GIN operator class and
-- supports @>, which is the only operator this column is ever queried with.
--
-- EXACTLY ONE STATEMENT, deliberately: Postgres wraps a multi-statement simple
-- query in an implicit transaction and CREATE INDEX CONCURRENTLY cannot run
-- inside one. Do not add a second statement to this file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS spaces_amenities_gin ON spaces USING gin (amenities jsonb_path_ops);
