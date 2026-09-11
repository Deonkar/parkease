-- 0011_updated_at_triggers.sql — hand-written
-- A trigger-maintained updated_at so a raw SQL fix in a console can't leave a stale timestamp.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Every table that has updated_at, except ledger_entries and audit_log (append-only).
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_roles_updated_at
  BEFORE UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_refresh_tokens_updated_at
  BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_spaces_updated_at
  BEFORE UPDATE ON spaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_space_slots_updated_at
  BEFORE UPDATE ON space_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_space_photos_updated_at
  BEFORE UPDATE ON space_photos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_booking_slots_updated_at
  BEFORE UPDATE ON booking_slots FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_refunds_updated_at
  BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_idempotency_keys_updated_at
  BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payouts_updated_at
  BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bank_details_updated_at
  BEFORE UPDATE ON bank_details FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_linked_accounts_updated_at
  BEFORE UPDATE ON linked_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_valet_profiles_updated_at
  BEFORE UPDATE ON valet_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_valet_jobs_updated_at
  BEFORE UPDATE ON valet_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_washer_profiles_updated_at
  BEFORE UPDATE ON washer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_wash_services_updated_at
  BEFORE UPDATE ON wash_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_wash_jobs_updated_at
  BEFORE UPDATE ON wash_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON push_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_surge_config_updated_at
  BEFORE UPDATE ON surge_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_surge_zone_overrides_updated_at
  BEFORE UPDATE ON surge_zone_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_outbox_messages_updated_at
  BEFORE UPDATE ON outbox_messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- audit_log append-only protection (shares the reject function from 0007)
CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM parkease_app;
GRANT SELECT, INSERT ON audit_log TO parkease_app;
