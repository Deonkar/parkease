-- 0042_space_review.sql
-- Task 18a: the admin's decision on a listing is recorded on the row it decides. `review_notes`
-- carries reject and request-changes notes alike (shown to the owner verbatim); `rejection_reason`
-- is backfilled into it and kept until a contract migration drops it (expand/contract).
SET lock_timeout = '5s';

ALTER TABLE spaces
  ADD COLUMN review_notes text,
  ADD COLUMN reviewed_by_user_id uuid REFERENCES users(id),
  ADD COLUMN reviewed_at timestamptz;

UPDATE spaces SET review_notes = rejection_reason WHERE rejection_reason IS NOT NULL;

-- Every FK gets an index (database.md). spaces is small at launch; a plain CREATE INDEX inside the
-- migration transaction is acceptable here and recorded in the migration review.
CREATE INDEX spaces_reviewed_by_user_id_idx ON spaces (reviewed_by_user_id);
