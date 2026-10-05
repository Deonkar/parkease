-- 0041_reviews_v2_validate.sql — hand-written
-- Validates 0040's NOT VALID CHECKs in their own file (learnings: in one file the VALIDATE would
-- scan under the ADD's ACCESS EXCLUSIVE). Rows only fail if a count is non-zero with a NULL average,
-- which nothing has ever written: no review exists yet, and seeds write both or neither.
ALTER TABLE spaces VALIDATE CONSTRAINT spaces_rating_read_model_check;
ALTER TABLE valet_profiles VALIDATE CONSTRAINT valet_profiles_rating_check;
ALTER TABLE washer_profiles VALIDATE CONSTRAINT washer_profiles_rating_check;
