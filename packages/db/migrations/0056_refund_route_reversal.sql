-- 0056_refund_route_reversal.sql
-- S-98: Route moved the owner's (or washer's) share to their Linked Account at capture, so a
-- refund afterwards left us paying the driver back from our own balance while the partner kept
-- the money (their payable going negative and staying there). A refund now records the partner's
-- share of what is refunded; the worker reverses exactly that from the transfer before refunding,
-- and stores the reversal's id so a retry never reverses twice. Nullable: refunds with no
-- transfer behind them carry nothing.
SET lock_timeout = '5s';

ALTER TABLE refunds
  ADD COLUMN route_reversal_paise bigint,
  ADD COLUMN route_reversal_id text;
ALTER TABLE refunds
  ADD CONSTRAINT refunds_route_reversal_paise_check
  CHECK (route_reversal_paise IS NULL OR route_reversal_paise > 0);
