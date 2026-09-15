-- 0017_bookings_check_in_method_constraints.sql — hand-written
-- Task 8, phase 2 of 3. Declares the constraints without scanning for them.
--
-- NOT VALID is metadata-only: it takes ACCESS EXCLUSIVE briefly, checks no
-- existing row, and starts enforcing the rule on every new and updated row
-- immediately. The scan over existing rows is deferred to 0018, which runs in
-- its own transaction under a lock that does not block writes.
--
-- Both constraints are added here, in one transaction, because both are
-- metadata-only: the combined lock is still microseconds.

ALTER TABLE bookings
  ADD CONSTRAINT bookings_check_in_method_check
  CHECK (check_in_method IS NULL OR check_in_method IN ('owner_scan', 'driver_fallback'))
  NOT VALID;

-- A checked-in booking must say how it was checked in. The two columns are
-- written together by CheckInCommand; this stops a later code path setting one
-- without the other, which is precisely how an audit trail rots.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_check_in_method_present_check
  CHECK ((checked_in_at IS NULL) = (check_in_method IS NULL))
  NOT VALID;
