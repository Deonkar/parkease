-- 0038_commission_waivers.sql — hand-written
-- Task 16c (ADR-032): the first 50 owners to activate Route pay no commission for 3 months.
--
-- commission_waivers is new and empty. bookings is hot: the column is added with a constant
-- default (metadata-only since PG 11, no rewrite), and its CHECK is added NOT VALID here and
-- validated in 0039, which takes SHARE UPDATE EXCLUSIVE and blocks no reads or writes.
-- FORWARD-ONLY.
CREATE TABLE commission_waivers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The cap lives here, not in application code: two activations at once cannot both be #50.
  slot integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_waivers_slot_check CHECK (slot BETWEEN 1 AND 50),
  CONSTRAINT commission_waivers_window_check CHECK (ends_at > starts_at)
);
-- One grant per owner, ever; also the index the quote-time lookup and the FK use.
CREATE UNIQUE INDEX commission_waivers_owner_id_key ON commission_waivers (owner_id);
CREATE UNIQUE INDEX commission_waivers_slot_key ON commission_waivers (slot);

ALTER TABLE bookings ADD COLUMN commission_waiver_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_commission_waiver_check CHECK (commission_waiver_paise >= 0) NOT VALID;
