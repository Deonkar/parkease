-- 0009_review_notification_surge.sql

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid REFERENCES users(id),
  rating smallint NOT NULL,
  comment text,
  owner_response text,
  is_reported text NOT NULL DEFAULT 'false',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX reviews_booking_reviewer_key ON reviews (booking_id, reviewer_user_id);
CREATE INDEX reviews_space_id_idx ON reviews (space_id);
CREATE INDEX reviews_reviewer_user_id_idx ON reviews (reviewer_user_id);
CREATE INDEX reviews_target_user_id_idx ON reviews (target_user_id);
CREATE INDEX reviews_booking_id_idx ON reviews (booking_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (
    type IN (
      'booking_confirmed','booking_reminder','booking_expired','booking_cancelled',
      'valet_assigned','valet_arrived','valet_parked',
      'wash_accepted','wash_completed',
      'payout_processed','review_request',
      'space_approved','space_rejected',
      'weekly_summary'
    )
  )
);

CREATE INDEX notifications_user_id_idx ON notifications (user_id);
CREATE INDEX notifications_user_id_is_read_idx ON notifications (user_id, is_read);

CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_platform_check CHECK (platform IN ('ios','android','web'))
);

CREATE UNIQUE INDEX push_tokens_token_key ON push_tokens (token);
CREATE INDEX push_tokens_user_id_idx ON push_tokens (user_id);

CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notification_preferences_user_id_key ON notification_preferences (user_id);

CREATE TABLE surge_config (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  base_multiplier_bp integer NOT NULL DEFAULT 10000,
  max_multiplier_bp integer NOT NULL DEFAULT 30000,
  demand_threshold integer NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surge_config_base_check CHECK (base_multiplier_bp >= 10000),
  CONSTRAINT surge_config_max_check CHECK (max_multiplier_bp >= base_multiplier_bp),
  CONSTRAINT surge_config_demand_check CHECK (demand_threshold BETWEEN 1 AND 100)
);

CREATE TABLE surge_zone_overrides (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  zone_id text NOT NULL,
  multiplier_bp integer NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surge_zone_overrides_multiplier_check CHECK (multiplier_bp >= 10000),
  CONSTRAINT surge_zone_overrides_valid_check CHECK (valid_until > valid_from)
);

CREATE INDEX surge_zone_overrides_zone_id_idx ON surge_zone_overrides (zone_id);
CREATE INDEX surge_zone_overrides_valid_range_idx ON surge_zone_overrides (valid_from, valid_until);
