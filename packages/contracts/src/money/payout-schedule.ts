/**
 * The RazorpayX payout schedule (task 16), shared by the worker that runs it and the API that
 * tells a valet when they will be paid, so the two cannot disagree. The worker's cron is
 * `'0 6 * * 1'` in Asia/Kolkata (`apps/worker/src/schedule.ts`); change both together.
 */
export const MINIMUM_PAYOUT_PAISE = 10_000;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const RUN_HOUR_IST = 6;

/** The IST date (`YYYY-MM-DD`) of the next Monday 06:00 IST run at or after `now`. */
export function nextPayoutOn(now: Date): string {
  // UTC getters on an instant shifted to IST: the host's timezone never moves the day.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const daysToMonday = (8 - ist.getUTCDay()) % 7;
  const ranToday = daysToMonday === 0 && ist.getUTCHours() >= RUN_HOUR_IST;
  const run = new Date(ist.getTime() + (ranToday ? 7 : daysToMonday) * DAY_MS);
  return run.toISOString().slice(0, 10);
}

/** The IST calendar date (`YYYY-MM-DD`) of an instant — the host's timezone never moves it. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
