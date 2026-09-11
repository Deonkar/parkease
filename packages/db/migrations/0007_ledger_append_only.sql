-- 0007_ledger_append_only.sql — hand-written
-- Enforce append-only on ledger_entries and audit_log (ADR-008).
-- Two layers: trigger (catches superuser/migration) + revoke (catches application path).

CREATE OR REPLACE FUNCTION ledger_entries_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only. Post a reversing entry instead of a % (ADR-008).',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_reject_mutation();

-- The application role has no grant to update/delete in the first place.
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM parkease_app;
GRANT SELECT, INSERT ON ledger_entries TO parkease_app;
