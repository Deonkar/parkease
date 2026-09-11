import type { Database } from '@parkease/db';
import type PgBoss from 'pg-boss';

export interface JobDeps {
  readonly db: Database;
  readonly boss: PgBoss;
}
