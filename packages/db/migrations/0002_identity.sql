-- 0002_identity.sql — users, user_roles, refresh_tokens

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  phone text NOT NULL,
  name text,
  email text,
  avatar_url text,
  status text NOT NULL DEFAULT 'active',
  firebase_uid text NOT NULL,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'blocked', 'deleted'))
);

CREATE UNIQUE INDEX users_phone_key ON users (phone);
CREATE UNIQUE INDEX users_firebase_uid_key ON users (firebase_uid);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_user_id uuid REFERENCES users(id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_role_check CHECK (role IN ('driver','owner','valet','washer','admin')),
  CONSTRAINT user_roles_status_check CHECK (status IN ('active', 'pending', 'suspended', 'rejected'))
);

CREATE UNIQUE INDEX user_roles_user_id_role_key ON user_roles (user_id, role);
CREATE INDEX user_roles_user_id_idx ON user_roles (user_id);
CREATE INDEX user_roles_granted_by_user_id_idx ON user_roles (granted_by_user_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
