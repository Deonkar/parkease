-- 0045_uploads.sql
-- S-50: every upload signature the API issues is recorded with who asked for it and the folder it
-- was signed into. Every endpoint that attaches an upload id (a wash photo, a valet proof, an ID
-- document, a space or business photo, an avatar) checks the id against this record, so a partner
-- cannot reach verification with an id they made up, and evidence cannot point at another user's
-- upload. A new table, written by nothing yet: no backfill, no lock on a hot table.
SET lock_timeout = '5s';

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Cloudinary's public_id as the upload response names it: parkease/<folder>/<uuid>.
  public_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uploads_public_id_key UNIQUE (public_id),
  CONSTRAINT uploads_folder_check
    CHECK (folder IN ('spaces', 'documents', 'avatars', 'reviews', 'proofs')),
  -- The id names its folder; the two can never disagree.
  CONSTRAINT uploads_public_id_in_folder_check
    CHECK (public_id LIKE 'parkease/' || folder || '/%')
);

CREATE INDEX uploads_user_id_idx ON uploads (user_id);
