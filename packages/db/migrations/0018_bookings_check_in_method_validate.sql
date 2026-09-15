-- 0018_bookings_check_in_method_validate.sql — hand-written
-- Task 8, phase 3 of 3. Proves the constraints against existing rows.
--
-- VALIDATE CONSTRAINT scans the table under SHARE UPDATE EXCLUSIVE, which
-- blocks neither reads nor writes — long wall-clock time, no outage. This is
-- only true because no ACCESS EXCLUSIVE lock from an earlier statement is still
-- held, which is why 0016 and 0017 are separate files.
--
-- Every existing row has check_in_method NULL and checked_in_at NULL, so
-- validation cannot fail today. The two-step is used anyway: it is the shape
-- that stays correct once bookings is no longer empty of checked-in rows.

ALTER TABLE bookings VALIDATE CONSTRAINT bookings_check_in_method_check;

ALTER TABLE bookings VALIDATE CONSTRAINT bookings_check_in_method_present_check;
