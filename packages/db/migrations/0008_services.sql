-- 0008_services.sql — valet and carwash tables

CREATE TABLE valet_profiles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  licence_document_id text,
  verification_status text NOT NULL DEFAULT 'unverified',
  is_available text NOT NULL DEFAULT 'false',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valet_profiles_verification_status_check CHECK (
    verification_status IN ('unverified','pending','verified','rejected')
  )
);

CREATE INDEX valet_profiles_user_id_idx ON valet_profiles (user_id);

CREATE TABLE valet_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  assigned_user_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'requested',
  fee_paise bigint,
  distance_m integer,
  pickup_photo_id text,
  dropoff_photo_id text,
  offered_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valet_jobs_status_check CHECK (
    status IN (
      'requested','offered','accepted','en_route','arrived',
      'parking','parked','return_requested','returning',
      'completed','cancelled','no_show'
    )
  )
);

CREATE INDEX valet_jobs_booking_id_idx ON valet_jobs (booking_id);
CREATE INDEX valet_jobs_assigned_user_id_idx ON valet_jobs (assigned_user_id);
CREATE INDEX valet_jobs_status_idx ON valet_jobs (status);

CREATE TABLE washer_profiles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verification_status text NOT NULL DEFAULT 'unverified',
  is_available text NOT NULL DEFAULT 'false',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT washer_profiles_verification_status_check CHECK (
    verification_status IN ('unverified','pending','verified','rejected')
  )
);

CREATE INDEX washer_profiles_user_id_idx ON washer_profiles (user_id);

CREATE TABLE wash_services (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_paise bigint NOT NULL,
  duration_minutes integer NOT NULL,
  vehicle_type text NOT NULL,
  is_active text NOT NULL DEFAULT 'true',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wash_services_price_check CHECK (price_paise > 0),
  CONSTRAINT wash_services_duration_check CHECK (duration_minutes > 0),
  CONSTRAINT wash_services_vehicle_type_check CHECK (vehicle_type IN ('car','two_wheeler'))
);

CREATE INDEX wash_services_user_id_idx ON wash_services (user_id);

CREATE TABLE wash_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid REFERENCES bookings(id),
  wash_service_id uuid NOT NULL REFERENCES wash_services(id),
  assigned_user_id uuid REFERENCES users(id),
  driver_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'requested',
  fee_paise bigint,
  before_photo_id text,
  after_photo_id text,
  offered_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wash_jobs_status_check CHECK (
    status IN ('requested','offered','accepted','en_route','washing','completed','cancelled')
  )
);

CREATE INDEX wash_jobs_booking_id_idx ON wash_jobs (booking_id);
CREATE INDEX wash_jobs_wash_service_id_idx ON wash_jobs (wash_service_id);
CREATE INDEX wash_jobs_assigned_user_id_idx ON wash_jobs (assigned_user_id);
CREATE INDEX wash_jobs_driver_user_id_idx ON wash_jobs (driver_user_id);
CREATE INDEX wash_jobs_status_idx ON wash_jobs (status);
