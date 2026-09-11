-- 0001_roles.sql — hand-written
-- Application role: the API connects as parkease_app, not the schema owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'parkease_app') THEN
    CREATE ROLE parkease_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO parkease_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO parkease_app;
