import type PgBoss from 'pg-boss';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function registerSchedule(boss: PgBoss): Promise<void> {
  // R-ASYNC-06: all cron expressions in one file, explicit Asia/Kolkata timezone.
  // Schedules arrive in task 4 (platform services).
}
