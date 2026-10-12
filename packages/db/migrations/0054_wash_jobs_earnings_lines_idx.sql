-- 0054_wash_jobs_earnings_lines_idx.sql
-- S-58: a partner's earnings lines are their completed jobs, newest first. The equality-only
-- washer index made the sort cover every job they ever did; this serves the order directly, with
-- id as the tiebreak so two jobs completed in the same instant keep one order across reads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS wash_jobs_earnings_lines_idx ON wash_jobs (washer_user_id, completed_at DESC, id DESC) WHERE status = 'completed';
