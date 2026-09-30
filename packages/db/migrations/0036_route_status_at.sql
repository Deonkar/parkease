-- 0036_route_status_at.sql — hand-written
-- Task 16b review: Route status writes are ordered by when Razorpay said them.
--
-- Razorpay does not deliver webhooks in order, and each carries its own event
-- id, so a late `under_review` could land after `activated` and hide an owner's
-- spaces again. A write now applies only when it is newer than the last one.
-- Nullable, no default: a metadata-only ADD COLUMN on a small table, behind
-- migrate.ts's 5s lock_timeout. FORWARD-ONLY; nothing here drops data.
ALTER TABLE linked_accounts ADD COLUMN route_status_at timestamptz;
