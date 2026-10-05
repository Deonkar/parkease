-- 0039_commission_waiver_validate.sql — hand-written
-- Validates 0038's NOT VALID CHECK in its own file: SHARE UPDATE EXCLUSIVE, so bookings keeps
-- taking reads and writes while it scans. Every existing row is 0 by 0038's default.
ALTER TABLE bookings VALIDATE CONSTRAINT bookings_commission_waiver_check;
