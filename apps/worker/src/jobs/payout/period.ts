const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Midnight IST at the start of `at`'s IST day, as an instant. */
export function istStartOfDay(at: Date): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS,
  );
}

/**
 * The payout's idempotency period: the ISO week the run falls in, read in IST
 * (`2026-W40`). `payouts_user_id_period_key` makes a second run in the same
 * week — a redelivery, a manual re-run — insert nothing.
 *
 * UTC getters on an instant shifted by +05:30, never local getters: the worker
 * host's timezone must not move a payout into a different week (learnings,
 * "`toIST(x)` is right with LOCAL getters and wrong with UTC ones").
 */
export function payoutPeriod(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  // The Thursday of this ISO week decides its year.
  const thursday = new Date(day + (3 - ((ist.getUTCDay() + 6) % 7)) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS));
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}
