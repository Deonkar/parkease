-- 0028_payments_carwash_validate.sql — hand-written
-- Task 13, phase 2 of 2 for the payments discriminator. Proves 0027's two
-- constraints against the rows that already existed.
--
-- VALIDATE CONSTRAINT scans the table under SHARE UPDATE EXCLUSIVE, which
-- blocks neither reads nor writes — long wall-clock time, no outage. That is
-- only true because no ACCESS EXCLUSIVE lock from an earlier statement is still
-- held, which is the whole reason 0027 and this are separate files (0018 and
-- 0023 set the precedent).
--
-- Every existing row predates purpose and wash_job_id, so it carries the
-- 'booking' default and a NULL job and cannot fail validation today. The
-- two-step is used anyway: it is the shape that stays correct once payments is
-- no longer small.

ALTER TABLE payments VALIDATE CONSTRAINT payments_purpose_check;

ALTER TABLE payments VALIDATE CONSTRAINT payments_wash_job_coherence_check;
