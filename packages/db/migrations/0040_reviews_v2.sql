-- 0040_reviews_v2.sql — hand-written
-- Task 17a. The v1 `reviews` table keyed one review per (booking, reviewer), so a booking with two
-- washers could only ever review one of them, and it stored is_reported as text. It is empty, read
-- and written by no code, and has never been deployed, so it is replaced rather than migrated
-- (user-approved 2026-10-05). The polymorphic (target_type, target_id) is the record of what was
-- said; spaces / valet_profiles / washer_profiles carry the read model search and dispatch read.
-- FORWARD-ONLY.
SET LOCAL lock_timeout = '5s';

DROP TABLE reviews;

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  booking_id uuid NOT NULL REFERENCES bookings (id),
  reviewer_user_id uuid NOT NULL REFERENCES users (id),
  reviewer_role text NOT NULL,
  target_type text NOT NULL,
  -- A space id, or a user id for driver / valet / washer. No FK: it points at one of two tables.
  target_id uuid NOT NULL,
  -- Whole stars. Basis points exist only in aggregates, where fractions do.
  rating smallint NOT NULL,
  comment text,
  owner_response text,
  owner_responded_at timestamptz,
  is_reported boolean NOT NULL DEFAULT false,
  moderation_status text NOT NULL DEFAULT 'visible',
  removed_by_user_id uuid REFERENCES users (id),
  removed_reason text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_comment_length_check
    CHECK (comment IS NULL OR char_length(comment) <= 500),
  CONSTRAINT reviews_owner_response_length_check
    CHECK (owner_response IS NULL OR char_length(owner_response) <= 500),
  CONSTRAINT reviews_reviewer_role_check CHECK (reviewer_role IN ('driver', 'owner')),
  CONSTRAINT reviews_target_type_check
    CHECK (target_type IN ('space', 'driver', 'valet', 'washer')),
  CONSTRAINT reviews_moderation_status_check
    CHECK (moderation_status IN ('visible', 'removed')),
  -- v1: drivers review spaces and partners, owners review drivers, and nobody else.
  CONSTRAINT reviews_reviewer_target_check
    CHECK ((reviewer_role = 'owner') = (target_type = 'driver')),
  CONSTRAINT reviews_owner_response_pair_check
    CHECK ((owner_response IS NULL) = (owner_responded_at IS NULL)),
  -- Removed means soft-deleted, and only then: the two cannot disagree.
  CONSTRAINT reviews_removed_consistent_check
    CHECK ((moderation_status = 'removed') = (deleted_at IS NOT NULL))
);

-- target_id in the key is the v1 fix: one opinion per counterparty per booking. Also the
-- booking_id FK index: it is the leading column.
CREATE UNIQUE INDEX reviews_one_per_counterparty_per_booking
  ON reviews (booking_id, reviewer_user_id, target_type, target_id);
-- Lists page newest-first on id (UUIDv7), per target; the recompute reads the same prefix.
CREATE INDEX reviews_target_idx ON reviews (target_type, target_id, id);
CREATE INDEX reviews_reviewer_user_id_idx ON reviews (reviewer_user_id);
CREATE INDEX reviews_removed_by_user_id_idx ON reviews (removed_by_user_id)
  WHERE removed_by_user_id IS NOT NULL;
-- The moderation queue is a partial-index scan in page order, not a GROUP BY over reports.
CREATE INDEX reviews_moderation_queue_idx ON reviews (id)
  WHERE is_reported AND deleted_at IS NULL;

-- DROP TABLE took 0011's trigger with it.
CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE review_reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  review_id uuid NOT NULL REFERENCES reviews (id),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL,
  detail text,
  -- Set when an admin dismisses the review: the report was judged, and leaves the queue. A later
  -- report from someone else re-queues the review with only its own reason.
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_reports_reason_check
    CHECK (reason IN ('spam_or_fake', 'inappropriate', 'irrelevant', 'other')),
  CONSTRAINT review_reports_detail_length_check
    CHECK (detail IS NULL OR char_length(detail) <= 500)
);
-- Also the review_id FK index: it is the leading column.
CREATE UNIQUE INDEX review_reports_one_per_reporter ON review_reports (review_id, reporter_user_id);
CREATE INDEX review_reports_reporter_user_id_idx ON review_reports (reporter_user_id);
CREATE TRIGGER trg_review_reports_updated_at
  BEFORE UPDATE ON review_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The read-model invariant: NULL average exactly when there are no reviews, so a new space or
-- partner is "New", never 0 stars. The `IS NOT NULL` is load-bearing: without it
-- `rating_count = 2, rating_avg_bp = NULL` makes the BETWEEN NULL, a NULL CHECK passes, and the
-- row is "rated" with no rating. 0026 and 0027 shipped that hole on valet_profiles and
-- washer_profiles, so both are replaced here. NOT VALID now, validated in 0041 under
-- SHARE UPDATE EXCLUSIVE, so none of the three tables stops taking reads or writes while it scans.
ALTER TABLE spaces
  ADD CONSTRAINT spaces_rating_read_model_check CHECK (
    (rating_count = 0 AND rating_avg_bp IS NULL)
    OR (rating_count > 0 AND rating_avg_bp IS NOT NULL AND rating_avg_bp BETWEEN 10000 AND 50000)
  ) NOT VALID;

ALTER TABLE valet_profiles
  DROP CONSTRAINT valet_profiles_rating_check,
  ADD CONSTRAINT valet_profiles_rating_check CHECK (
    (rating_count = 0 AND rating_avg_bp IS NULL)
    OR (rating_count > 0 AND rating_avg_bp IS NOT NULL AND rating_avg_bp BETWEEN 10000 AND 50000)
  ) NOT VALID;

ALTER TABLE washer_profiles
  DROP CONSTRAINT washer_profiles_rating_check,
  ADD CONSTRAINT washer_profiles_rating_check CHECK (
    (rating_count = 0 AND rating_avg_bp IS NULL)
    OR (rating_count > 0 AND rating_avg_bp IS NOT NULL AND rating_avg_bp BETWEEN 10000 AND 50000)
  ) NOT VALID;
