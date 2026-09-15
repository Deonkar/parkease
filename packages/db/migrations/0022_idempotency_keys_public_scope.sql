-- 0022_idempotency_keys_public_scope.sql — hand-written
-- Task 9, phase 4 of 5. Lets an unauthenticated request claim a key.
--
-- Most idempotency keys belong to a signed-in user who minted them. Two kinds do
-- not, and both are reachable today:
--
--   * A Razorpay webhook. ADR-011 deduplicates it on the event id in this table,
--     and Razorpay is not a user.
--   * Anything under /auth. A phone login or a token refresh is the request that
--     *creates* the session; there is no user until it succeeds.
--
-- The second one is a live defect this migration is what makes fixable.
-- `IdempotencyInterceptor` writes the literal string 'anonymous' when
-- `request.user` is absent, and 'anonymous' is not a uuid — so every
-- POST /auth/session and POST /auth/refresh currently fails the insert with
-- 22P02 and surfaces as a 500. It went unnoticed because the HTTP-level harness
-- deliberately excludes AuthModule (FirebaseVerifierService throws on fake
-- credentials), so no test ever drove a public mutation through the interceptor.
--
-- user_id therefore becomes nullable — and immediately gets a constraint, because
-- "nullable" on its own would also let a driver's booking store a key with no
-- owner, and a key with no owner on a user route is a key any user can replay.
-- The database enforces the invariant the application cannot be trusted with
-- (R-DB-05); the route prefixes are the part the database can actually see.
--
-- LIKE on prefixes rather than equality with literal paths: a second webhook or
-- a new auth route is a route we will add, not a constraint we should have to
-- migrate. Everything outside those two prefixes still must name its user.
--
-- Both statements are metadata-only. DROP NOT NULL clears a pg_attribute flag;
-- CHECK ... NOT VALID checks no existing row.

ALTER TABLE idempotency_keys ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_user_or_public_check
  CHECK (
    user_id IS NOT NULL
    OR endpoint LIKE 'POST /api/v1/webhooks/%'
    OR endpoint LIKE 'POST /api/v1/auth/%'
  )
  NOT VALID;
