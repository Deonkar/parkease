import type PgBoss from 'pg-boss';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function registerHandlers(boss: PgBoss): Promise<void> {
  // R-ASYNC-04: every job name is bound in exactly one file.
  // Handlers arrive in task 4 (platform services).
}
