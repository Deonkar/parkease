-- 0050_integrity_checks.sql
-- Database guards for rules only the application held. Each is added NOT VALID (no scan under the
-- ACCESS EXCLUSIVE lock); 0051 validates them in its own file. A row written before a rule existed
-- fails 0051 loudly, which is the audit: fix the row, then re-run.
SET lock_timeout = '5s';

-- S-32: a completed wash has a completion time. The earnings query relies on it.
ALTER TABLE wash_jobs
  ADD CONSTRAINT wash_jobs_completed_at_check
  CHECK (status <> 'completed' OR completed_at IS NOT NULL) NOT VALID;

-- S-47: the stored price obeys the contract's bound (MIN/MAX_SERVICE_PRICE_PAISE, ₹10–₹9,999),
-- so the menu's toggle (which re-saves prices through the bounded schema) can never be stuck.
ALTER TABLE wash_services
  ADD CONSTRAINT wash_services_price_range_check
  CHECK (price_paise BETWEEN 1000 AND 999900) NOT VALID;

-- S-57: a business is reviewed with 1–10 photos, and nobody's display name is blank.
ALTER TABLE washer_profiles
  ADD CONSTRAINT washer_profiles_business_photos_check
  CHECK (partner_type <> 'business' OR cardinality(business_photo_ids) BETWEEN 1 AND 10) NOT VALID;
ALTER TABLE washer_profiles
  ADD CONSTRAINT washer_profiles_business_name_not_blank_check
  CHECK (business_name IS NULL OR btrim(business_name) <> '') NOT VALID;

-- S-56: capabilities name only services in the catalogue (CARWASH_SERVICE_NAME_VALUES).
ALTER TABLE washer_profiles
  ADD CONSTRAINT washer_profiles_capabilities_check
  CHECK (capabilities <@ ARRAY['basic_exterior','premium_wash','interior_only','full_detailing','quick_wipe']::text[]) NOT VALID;
