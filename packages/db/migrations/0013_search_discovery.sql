-- 0013_search_discovery.sql — hand-written
-- zone_id becomes a geohash cell, for driver discovery (task 7).
--
-- lock_timeout and statement_timeout are set on the connection in
-- src/migrate.ts, not here, so that sibling migrations needing
-- CREATE INDEX CONCURRENTLY can be single-statement files.
--
-- Forward-only. The old zone_id values were 'zone_<pincode>', which is
-- derivable from spaces.pincode at any time, so a down path would be
-- reconstructable but pointless: nothing reads the pincode form after this.

-- zone_id was 'zone_<pincode>', which is a postal boundary, not a demand
-- boundary: one pincode spans several square kilometres while surge is priced
-- per ~1.2km cell. Discovery reads this column, the surge worker writes
-- surge:{zone_id} to Redis, and apps/api/src/platform/geo/geohash.ts produces
-- the identical string for the same point (asserted by the geohash-agreement
-- integration test).
--
-- ST_GeoHash is IMMUTABLE, so this is a single-pass rewrite of one column. It
-- is deliberately NOT chunked: the whole point of running it now, before task
-- 22 provisions any host, is that spaces holds development data only and no
-- client is connected. A chunked backfill against a live table is task 22's
-- problem if this ever needs re-running.
UPDATE spaces
   SET zone_id = ST_GeoHash(location::geometry, 6)
 WHERE zone_id IS DISTINCT FROM ST_GeoHash(location::geometry, 6);

-- surge_zone_overrides rows were keyed to the old pincode-shaped zone ids, so
-- they no longer name a reachable zone. There is no correct pincode -> geohash
-- mapping (one pincode covers many cells), and surge does not start writing
-- until task 10, so dropping the stale rows is honest where a silent rewrite
-- would not be. Intentional data loss, on rows that are unreachable either way.
DELETE FROM surge_zone_overrides WHERE zone_id LIKE 'zone\_%';
