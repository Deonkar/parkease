import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export type EarningsPeriod = 'today' | 'week' | 'month' | 'all';

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/**
 * Period start in Asia/Kolkata. A partner's or owner's week starts when THEIR
 * week starts, not UTC's. Extracted from the washer earnings query on its
 * second use (R-ARCH-07): two hand-written copies of this boundary is how two
 * screens start disagreeing about when the week began. `all` is unbounded.
 */
export function periodBound(column: SQLWrapper, period: EarningsPeriod): SQL | undefined {
  if (period === 'all') return undefined;
  const unit = period === 'today' ? 'day' : period;
  return sql`${column} >= date_trunc(${unit}, now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
}

/** Last month from its IST 1st up to this instant a month ago — the growth baseline. */
export function lastMonthToDate(column: SQLWrapper): SQL {
  return sql`${column} >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month') AT TIME ZONE 'Asia/Kolkata' AND ${column} < now() - interval '1 month'`;
}

/**
 * The IST calendar dates a period covers, oldest first, as `YYYY-MM-DD`. The
 * day buckets are zero-filled against this list so the bars have one slot per
 * day. Same boundaries as `periodBound`: ISO weeks start Monday.
 */
export function istDays(period: 'today' | 'week' | 'month', now = new Date()): string[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const end = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start =
    period === 'today'
      ? end
      : period === 'week'
        ? end - ((ist.getUTCDay() + 6) % 7) * DAY_MS
        : Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1);

  const days: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** Midnight IST today, as an instant. */
export function istStartOfToday(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS,
  );
}
