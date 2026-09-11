-- 0005_booking_slots_exclusion.sql — hand-written
-- Bookings, booking_slots, and the exclusion constraint (ADR-007).

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  driver_id uuid NOT NULL REFERENCES users(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  vehicle_type text NOT NULL,
  vehicle_number text,
  duration_type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment',

  base_paise bigint NOT NULL,
  surge_premium_paise bigint NOT NULL DEFAULT 0,
  surge_multiplier_bp integer NOT NULL DEFAULT 10000,
  parkease_fee_paise bigint NOT NULL,
  gst_paise bigint NOT NULL,
  total_paise bigint NOT NULL,
  owner_earnings_paise bigint NOT NULL,

  checked_in_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT bookings_window_check CHECK (ends_at > starts_at),
  CONSTRAINT bookings_total_check CHECK (total_paise > 0),
  CONSTRAINT bookings_balance_check CHECK (total_paise = base_paise + surge_premium_paise + gst_paise),
  CONSTRAINT bookings_status_check CHECK (
    status IN ('pending_payment','confirmed','active','completed','cancelled','expired','no_show')
  ),
  CONSTRAINT bookings_vehicle_type_check CHECK (vehicle_type IN ('car','two_wheeler')),
  CONSTRAINT bookings_duration_type_check CHECK (duration_type IN ('hourly','daily','weekly','monthly'))
);

CREATE INDEX bookings_driver_id_idx ON bookings (driver_id);
CREATE INDEX bookings_space_id_idx ON bookings (space_id);
CREATE INDEX bookings_status_starts_at_idx ON bookings (status, starts_at);

CREATE TABLE booking_slots (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id),
  vehicle_type text NOT NULL,
  slot_index integer NOT NULL,
  period tstzrange NOT NULL,
  status text NOT NULL DEFAULT 'held',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_slots_status_check CHECK (status IN ('held','confirmed','active','released')),
  CONSTRAINT booking_slots_vehicle_type_check CHECK (vehicle_type IN ('car','two_wheeler'))
);

CREATE INDEX booking_slots_booking_id_idx ON booking_slots (booking_id);
CREATE INDEX booking_slots_space_id_idx ON booking_slots (space_id);

ALTER TABLE booking_slots
  ADD CONSTRAINT booking_slots_no_overlap
  EXCLUDE USING gist (
    space_id     WITH =,
    vehicle_type WITH =,
    slot_index   WITH =,
    period       WITH &&
  ) WHERE (status IN ('confirmed', 'active'));
