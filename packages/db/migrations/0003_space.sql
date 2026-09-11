-- 0003_space.sql — spaces, space_slots, space_photos
-- Note: the geography column and GiST indexes are in 0004_spaces_spatial.sql

CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  address_line text NOT NULL,
  landmark text,
  city text NOT NULL,
  state text NOT NULL,
  pincode text NOT NULL,
  zone_id text NOT NULL,
  approval_status text NOT NULL DEFAULT 'draft',
  rejection_reason text,
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES users(id),
  amenities jsonb NOT NULL DEFAULT '{}',
  schedule jsonb NOT NULL,
  rating_avg_bp integer,
  rating_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT spaces_approval_status_check CHECK (
    approval_status IN ('draft','pending_review','active','changes_requested','rejected','paused')
  ),
  CONSTRAINT spaces_pincode_check CHECK (pincode ~ '^[1-9][0-9]{5}$')
);

CREATE INDEX spaces_owner_id_idx ON spaces (owner_id);
CREATE INDEX spaces_approved_by_user_id_idx ON spaces (approved_by_user_id);
CREATE INDEX spaces_zone_id_idx ON spaces (zone_id);
CREATE INDEX spaces_approval_status_idx ON spaces (approval_status);

CREATE TABLE space_slots (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  slot_index integer NOT NULL,
  price_paise_hourly bigint NOT NULL,
  price_paise_daily bigint,
  price_paise_weekly bigint,
  price_paise_monthly bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_slots_vehicle_type_check CHECK (vehicle_type IN ('car','two_wheeler')),
  CONSTRAINT space_slots_slot_index_check CHECK (slot_index >= 0),
  CONSTRAINT space_slots_price_hourly_check CHECK (price_paise_hourly > 0)
);

CREATE UNIQUE INDEX space_slots_space_vehicle_index_key ON space_slots (space_id, vehicle_type, slot_index);
CREATE INDEX space_slots_space_id_idx ON space_slots (space_id);

CREATE TABLE space_photos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  cloudinary_public_id text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX space_photos_space_id_idx ON space_photos (space_id);
