-- 0035_route_onboarding.sql — hand-written
-- Task 16b: Route Linked Account onboarding for owners and washers.
--
-- `linked_accounts` has never been written by application code (tasks 9 and 13
-- only read it; nothing created an account), so every statement here takes
-- ACCESS EXCLUSIVE on an empty table for microseconds, behind migrate.ts's 5s
-- lock_timeout. FORWARD-ONLY; nothing here drops data.

-- The resumable onboarding sequence saves each Razorpay id before the next call.
ALTER TABLE linked_accounts
  ADD COLUMN razorpay_stakeholder_id text,
  ADD COLUMN razorpay_product_id text,
  -- Razorpay's `requirements` on needs_clarification: which field, and why.
  ADD COLUMN requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Display only. The PAN and the full account number live at Razorpay, never here.
  ADD COLUMN legal_name text,
  ADD COLUMN settlement_last4 text,
  ADD COLUMN settlement_ifsc_prefix text;

ALTER TABLE linked_accounts DROP CONSTRAINT linked_accounts_kyc_status_check;
ALTER TABLE linked_accounts
  ADD CONSTRAINT linked_accounts_kyc_status_check CHECK (
    kyc_status IN ('pending','under_review','needs_clarification','activated','rejected','suspended')
  );

-- One Linked Account per user: the onboarding command resumes the row it finds.
CREATE UNIQUE INDEX linked_accounts_user_id_key ON linked_accounts (user_id);
DROP INDEX linked_accounts_user_id_idx;

-- The webhook finds the row by Razorpay's account id.
CREATE UNIQUE INDEX linked_accounts_razorpay_account_id_key ON linked_accounts (razorpay_account_id);
