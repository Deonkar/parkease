-- 0031_wash_evidence_freeze.sql — hand-written
-- Task 14 final fix wave, database lens M1 + L9. The row-level half of "wash
-- evidence stops changing once the job has moved past it".
--
-- `CarwashService.attachPhoto` refuses a photo whose slot has closed, in the
-- same UPDATE as its ownership check (T7-S1). That guard is application-only,
-- so a console fix, a backfill or a future second write path can still replace
-- a before photo after the car was clean, or an after photo on a completed and
-- paid job. Rule 5 and learnings.md ("A photo gate belongs in the CHECK
-- constraint as well as the command") put the invariant in the database too:
-- the command is what turns the refusal into a message; this makes the edit
-- unreachable by any path.
--
-- LOCKS. wash_jobs has never been written outside Testcontainers (0030's
-- header), so every statement here holds its lock for microseconds. The
-- lock_timeout is set here as well as by migrate.ts, so a busy table fails the
-- migration fast rather than queueing every reader behind it — including when
-- this file is run by hand.
--
-- The CHECK is added NOT VALID here and proven by 0032, in its own file.
--
-- FORWARD-ONLY. Recovery is DROP TRIGGER wash_jobs_evidence_freeze, DROP
-- FUNCTION wash_jobs_reject_evidence_edit(), and DROP CONSTRAINT
-- wash_jobs_photos_distinct_check. Nothing here rewrites or loses data.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. A photo is frozen once its moment has passed
-- ---------------------------------------------------------------------------
--
-- The slots mirror PHOTO_SLOT_OPEN_STATUSES from the other side: `before` is
-- evidence of the car before washing, so it freezes once washing has started;
-- `after` is evidence of the finished car, so it freezes once the job is
-- completed. A cancelled job's photos freeze too — they are the record of what
-- was done before the cancel, and a dispute over it reads them.
--
-- Keyed on OLD.status, not NEW.status: `complete` writes the status and never
-- the photos, so the question is always "was this photo already evidence
-- before this UPDATE", which only the old row can answer.
--
-- SQLSTATE 23514 (check_violation) with a CONSTRAINT name, so the refusal
-- reads like the CHECK constraints beside it — `pgConstraintName()` finds it,
-- and the API's exception filter treats it as the 500 it is (an application
-- guard was bypassed), never as a 4xx the partner is told to fix.
CREATE FUNCTION wash_jobs_reject_evidence_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('washing', 'completed', 'cancelled')
     AND NEW.before_photo_id IS DISTINCT FROM OLD.before_photo_id THEN
    RAISE EXCEPTION
      'wash job %: the before photo is evidence once washing has started (was %)',
      OLD.id, OLD.status
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'wash_jobs_evidence_frozen';
  END IF;

  IF OLD.status IN ('completed', 'cancelled')
     AND NEW.after_photo_id IS DISTINCT FROM OLD.after_photo_id THEN
    RAISE EXCEPTION
      'wash job %: the after photo is evidence once the job is closed (was %)',
      OLD.id, OLD.status
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'wash_jobs_evidence_frozen';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `UPDATE OF` the two photo columns, so every status move, offer widening and
-- `updated_at` touch on this table never enters the function at all.
CREATE TRIGGER wash_jobs_evidence_freeze
  BEFORE UPDATE OF before_photo_id, after_photo_id ON wash_jobs
  FOR EACH ROW EXECUTE FUNCTION wash_jobs_reject_evidence_edit();

-- ---------------------------------------------------------------------------
-- 2. One image cannot be evidence of two moments
-- ---------------------------------------------------------------------------
--
-- An after photo that is the before photo re-sent is a completed wash with no
-- evidence it happened. Not named `..._status_check`: enum-drift finds status
-- enums by that pattern (learnings.md).
ALTER TABLE wash_jobs
  ADD CONSTRAINT wash_jobs_photos_distinct_check
    CHECK (after_photo_id IS NULL OR after_photo_id <> before_photo_id) NOT VALID;

-- VALIDATE is 0032, not the next line. migrate.ts sends a file as one implicit
-- transaction, so a VALIDATE here would scan while this ADD CONSTRAINT's ACCESS
-- EXCLUSIVE is still held — the two-step's whole point lost (0017/0018 and
-- 0027/0028 set the precedent; postgres-migration-reviewer, M-6/M-10).
