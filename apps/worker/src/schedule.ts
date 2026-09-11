import type PgBoss from 'pg-boss';

const IST = 'Asia/Kolkata';

export async function registerSchedule(boss: PgBoss): Promise<void> {
  await boss.schedule('outbox.relay', '* * * * *', {}, { tz: IST });
  await boss.schedule('ledger.assert-balance', '*/15 * * * *', {}, { tz: IST });
  await boss.schedule('idempotency.prune', '0 3 * * *', {}, { tz: IST });
}
