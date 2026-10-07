-- 0049_drop_valet_offers_job_id_idx.sql
-- S-21: valet_job_offers_job_valet_key is UNIQUE (job_id, valet_user_id), so its leading column
-- already serves WHERE job_id = ?. This second B-tree covered nothing the composite does not and
-- was maintained on every offer row (five per job per round). 0030 dropped the car wash twin.
-- CONCURRENTLY, so it is the only statement in this file (it cannot run in a transaction).
DROP INDEX CONCURRENTLY IF EXISTS valet_job_offers_job_id_idx;
