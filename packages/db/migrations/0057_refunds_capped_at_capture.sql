-- 0057_refunds_capped_at_capture.sql
-- S-142 (rule 5): the refunds against one payment can never add up to more than it captured.
-- Every refund counts whatever its gateway status: its ledger posting committed when it was
-- created, and a failed refund is retried, not forgotten (refund-options.ts `refundableOf`). The
-- application checks the same sum; this is the guard that holds when a code path forgets to.
-- The payment row is locked first, so two concurrent refunds against one capture serialise here
-- instead of each seeing the other's absence.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION refunds_capped_at_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  captured bigint;
  already bigint;
BEGIN
  SELECT captured_paise INTO captured FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT coalesce(sum(amount_paise), 0) INTO already
    FROM refunds WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF already + NEW.amount_paise > coalesce(captured, 0) THEN
    RAISE EXCEPTION 'refunds for payment % would exceed its capture (% + % > %)',
      NEW.payment_id, already, NEW.amount_paise, coalesce(captured, 0)
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_capped_at_capture';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refunds_capped_at_capture
  BEFORE INSERT OR UPDATE OF amount_paise, payment_id ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_capped_at_capture();
