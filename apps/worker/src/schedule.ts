import type PgBoss from 'pg-boss';

import { SURGE_RECALCULATE } from './jobs/surge/recalculate.job.js';

const IST = 'Asia/Kolkata';

export async function registerSchedule(boss: PgBoss): Promise<void> {
  await boss.schedule('outbox.relay', '* * * * *', {}, { tz: IST });
  await boss.schedule('ledger.assert-balance', '*/15 * * * *', {}, { tz: IST });
  await boss.schedule('idempotency.prune', '0 3 * * *', {}, { tz: IST });

  // Five minutes is the cycle the 600s surge TTL is sized against: two missed
  // runs still leave a valid key (R-ASYNC-06, ADR-010).
  await boss.schedule(SURGE_RECALCULATE, '*/5 * * * *', {}, { tz: IST });
}
