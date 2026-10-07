-- 0051_integrity_checks_validate.sql
-- Validates 0050's NOT VALID CHECKs in their own file, so the scan runs under the weaker lock.
ALTER TABLE wash_jobs VALIDATE CONSTRAINT wash_jobs_completed_at_check;
ALTER TABLE wash_services VALIDATE CONSTRAINT wash_services_price_range_check;
ALTER TABLE washer_profiles VALIDATE CONSTRAINT washer_profiles_business_photos_check;
ALTER TABLE washer_profiles VALIDATE CONSTRAINT washer_profiles_business_name_not_blank_check;
ALTER TABLE washer_profiles VALIDATE CONSTRAINT washer_profiles_capabilities_check;
