-- 0025_spaces_zone_id_backfill.sql — hand-written
-- Task 10. Repairs `spaces.zone_id` for rows the API wrote after 0013.
--
-- WHY THIS EXISTS.
--
-- 0013 replaced the `zone_<pincode>` zone format with a geohash-6 cell and
-- backfilled every row that existed at that moment. What it could not do is
-- update the two write paths, and nobody did: `create-space.command.ts` and
-- `update-space.command.ts` kept composing `zone_<pincode>` until this branch
-- fixed them. So every space created or edited through the API between 0013 and
-- now carries a value that cannot match a geohash-6 cell.
--
-- That is not cosmetic. `search.service` selects this column straight into the
-- surge lookup, and Redis is a cache (ADR-010) — a key that does not match is a
-- miss, a miss degrades silently to base pricing, and nothing is logged. The
-- symptom is a listing that simply never surges, with no error to explain it.
-- Task 10 would have shipped and quietly not worked for those spaces.
--
-- WHY IT IS SAFE.
--
-- The UPDATE is bounded by the predicate, not by the table: only rows whose
-- zone_id is not already a geohash-6 cell are touched. On a database that has
-- had no API writes since 0013 this matches zero rows and the statement is a
-- no-op. Re-running it is also a no-op, because a repaired row no longer
-- matches the predicate — so this migration is idempotent by construction
-- rather than by a flag.
--
-- It is deliberately NOT chunked. Chunking exists to stop a long write holding
-- row locks and bloating a table, and that trade only pays when the row count is
-- large. `spaces` is this platform's listing table at task 10 of 22; the guard
-- below refuses to run if it has grown past the point where one statement is
-- still the right shape, rather than assuming it has not. An operator who hits
-- that guard has lost nothing — no rows are changed and the migration stops.
DO $$
DECLARE
  stale bigint;
  threshold constant bigint := 50000;
BEGIN
  SELECT count(*) INTO stale
  FROM spaces
  WHERE zone_id IS NULL OR zone_id !~ '^[0-9bcdefghjkmnpqrstuvwxyz]{6}$';

  IF stale > threshold THEN
    RAISE EXCEPTION
      'spaces holds % rows with a stale zone_id (limit %). This migration repairs them in one UPDATE, which at this size would hold row locks long enough to matter. Chunk the backfill or run it in a maintenance window.',
      stale, threshold;
  END IF;

  RAISE NOTICE 'zone_id backfill: % row(s) to repair', stale;
END $$;

-- ST_GeoHash over the same geometry and precision the application uses. The
-- precision is 6 in exactly one place in TypeScript (contracts'
-- ZONE_GEOHASH_PRECISION, which the API and the worker both import) and is
-- repeated here because SQL cannot import it — the agreement between the two is
-- what `geohash-agreement.integration.test.ts` exists to assert.
UPDATE spaces
SET zone_id = ST_GeoHash(location::geometry, 6)
WHERE zone_id IS NULL OR zone_id !~ '^[0-9bcdefghjkmnpqrstuvwxyz]{6}$';

-- The invariant, checked rather than hoped for: after this runs, no space can
-- carry a zone id the surge cache is unable to address. A migration that
-- repaired most rows and left a few would be worse than one that failed, since
-- the remainder would go on silently never surging.
DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT count(*) INTO remaining
  FROM spaces
  WHERE zone_id IS NULL OR zone_id !~ '^[0-9bcdefghjkmnpqrstuvwxyz]{6}$';

  IF remaining > 0 THEN
    RAISE EXCEPTION 'zone_id backfill left % row(s) unrepaired', remaining;
  END IF;
END $$;
