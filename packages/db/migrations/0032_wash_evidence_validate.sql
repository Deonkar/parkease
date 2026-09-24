-- 0032_wash_evidence_validate.sql — hand-written
-- Task 14 final fix wave, phase 2 of 2 for 0031's distinct-photos CHECK.
-- Proves `wash_jobs_photos_distinct_check` against the rows that already exist.
--
-- VALIDATE CONSTRAINT scans the table under SHARE UPDATE EXCLUSIVE, which
-- blocks neither reads nor writes — long wall-clock time, no outage. That is
-- only true because no ACCESS EXCLUSIVE lock from 0031's ADD CONSTRAINT is still
-- held, which is the whole reason this is a separate file (0018, 0023 and 0028
-- set the precedent).
--
-- No existing row can fail: every fixture and every production write path
-- attaches two different upload ids. The two-step is used anyway, because it
-- is the shape that stays correct once wash_jobs is no longer empty.

SET LOCAL lock_timeout = '5s';

ALTER TABLE wash_jobs VALIDATE CONSTRAINT wash_jobs_photos_distinct_check;
