-- 0043_notification_delivery.sql
-- Task 19a: push delivery. `notifications.type` now holds a catalog template key
-- (packages/contracts notification-catalog), validated in the application where the copy lives, so
-- the 14-value CHECK that nothing ever wrote against is dropped. The table has never been written
-- to, which is why the new columns can be added in one step without an expand/contract pair.
SET lock_timeout = '5s';

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE notifications
  ADD COLUMN category text NOT NULL DEFAULT 'account',
  ADD COLUMN actionable boolean NOT NULL DEFAULT false,
  ADD COLUMN deep_link text,
  ADD COLUMN dedupe_key text;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_category_check CHECK (category IN (
    'bookings','valet','carwash','jobs','spaces','payouts','reviews','account','promotions'));

-- A job delivered twice (pg-boss is at-least-once) inserts one row: the job id is the key.
CREATE UNIQUE INDEX notifications_dedupe_key_key ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
-- The feed is keyset-paged on the id (UUIDv7, so id order is creation order).
CREATE INDEX notifications_user_id_id_idx ON notifications (user_id, id DESC);

-- Expo answers a send with one ticket per message and a receipt ~15 minutes later. The ticket id is
-- what correlates a receipt back to the token it was for, so it is stored until it is read.
CREATE TABLE push_receipts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_id text NOT NULL,
  token_id uuid NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_receipts_ticket_id_key ON push_receipts (ticket_id);
CREATE INDEX push_receipts_token_id_idx ON push_receipts (token_id);
CREATE INDEX push_receipts_pending_idx ON push_receipts (created_at) WHERE processed_at IS NULL;
