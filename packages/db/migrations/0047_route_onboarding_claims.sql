-- 0047_route_onboarding_claims.sql
-- S-112: one Route onboarding submit runs per user at a time. Two devices (or a retry with a
-- fresh Idempotency-Key) could both find no linked account, both create one at Razorpay, and the
-- second would orphan the first: a PAN-bearing stakeholder nobody owns. The claim is taken before
-- the first Razorpay call, outside any transaction, and released when the submit ends; a claim
-- older than its TTL (a crashed submit) is taken over. A new, empty table.
SET lock_timeout = '5s';

CREATE TABLE route_onboarding_claims (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_onboarding_claims_user_id_key UNIQUE (user_id)
);
