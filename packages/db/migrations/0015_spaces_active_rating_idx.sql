-- 0015_spaces_active_rating_idx.sql — hand-written
-- sortBy=rating orders by coalesce(rating_avg_bp, 0) DESC, id DESC over the
-- active set (task 7). Without this, a rating sort degrades to a full sort of
-- every candidate the spatial index returns.
--
-- EXACTLY ONE STATEMENT — see 0014 for why. Do not add a second statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS spaces_active_rating_idx ON spaces (coalesce(rating_avg_bp, 0) DESC, id DESC) WHERE approval_status = 'active' AND deleted_at IS NULL;
