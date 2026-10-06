import type PgBoss from 'pg-boss';

import { PAYOUT_RECONCILE_JOB, PAYOUT_RUN_WEEKLY_JOB } from './jobs/payout/payload.js';
import { REVIEW_RECOMPUTE_AGGREGATES_JOB } from './jobs/review/recompute-aggregates.job.js';
import { SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';

const IST = 'Asia/Kolkata';

export async function registerSchedule(boss: PgBoss): Promise<void> {
  await boss.schedule('outbox.relay', '* * * * *', {}, { tz: IST });
  await boss.schedule('ledger.assert-balance', '*/15 * * * *', {}, { tz: IST });
  await boss.schedule('idempotency.prune', '0 3 * * *', {}, { tz: IST });

  // Five minutes is the cycle the 600s surge TTL is sized against: two missed
  // runs still leave a valid key (R-ASYNC-06, ADR-010).
  await boss.schedule(SURGE_RECALCULATE, '*/5 * * * *', {}, { tz: IST });

  // Monday 06:00 IST (§16.6).
  await boss.schedule(PAYOUT_RUN_WEEKLY_JOB, '0 6 * * 1', {}, { tz: IST });
  // Daily 02:00 IST (§16.7): yesterday's captures and every payout in flight.
  await boss.schedule(PAYOUT_RECONCILE_JOB, '0 2 * * *', {}, { tz: IST });
  // Daily 03:30 IST (§17.6): reviews that aged out of the 30-day recency window yesterday.
  await boss.schedule(REVIEW_RECOMPUTE_AGGREGATES_JOB, '30 3 * * *', {}, { tz: IST });
}
