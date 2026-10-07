-- 0048_offer_self_guard.sql
-- S-20: nothing in the database stopped an offer naming the job's own driver as its partner. The
-- candidate queries exclude the driver, and wash_jobs carries washer_is_not_driver, but a direct
-- write to either offer table could still record a self-offer. The rule needs a value from another
-- row (the job's driver), which a CHECK cannot see, so it is a trigger: decided deliberately as
-- the database's own statement of a money rule (a partner earning from their own booking), not a
-- restatement of an application filter.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION offers_refuse_self_offer() RETURNS trigger AS $$
DECLARE
  driver uuid;
  partner uuid;
BEGIN
  IF TG_TABLE_NAME = 'valet_job_offers' THEN
    SELECT driver_user_id INTO driver FROM valet_jobs WHERE id = NEW.job_id;
    partner := NEW.valet_user_id;
  ELSE
    SELECT driver_user_id INTO driver FROM wash_jobs WHERE id = NEW.job_id;
    partner := NEW.washer_user_id;
  END IF;
  IF driver IS NOT NULL AND partner = driver THEN
    RAISE EXCEPTION 'a job cannot be offered to its own driver'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'offers_not_to_own_driver';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER valet_job_offers_not_to_own_driver
  BEFORE INSERT OR UPDATE OF valet_user_id, job_id ON valet_job_offers
  FOR EACH ROW EXECUTE FUNCTION offers_refuse_self_offer();

CREATE TRIGGER wash_job_offers_not_to_own_driver
  BEFORE INSERT OR UPDATE OF washer_user_id, job_id ON wash_job_offers
  FOR EACH ROW EXECUTE FUNCTION offers_refuse_self_offer();
