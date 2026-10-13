import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_LAG_BUDGET_SECONDS, OUTBOX_LAG_SECONDS } from '@parkease/db/queries';

import { DB, type Database } from '../db/db.module.js';

export { OUTBOX_LAG_BUDGET_SECONDS };

/** The worker's own outbox-lag reading, taken from the API (S-156): see `/health/pipeline`. */
@Injectable()
export class OutboxLagQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Whole seconds the oldest ready message has waited; 0 with none waiting. */
  async seconds(): Promise<number> {
    const [row] = await this.db.execute<{ lag: number | null }>(OUTBOX_LAG_SECONDS);
    return Math.round(Math.max(0, row?.lag ?? 0));
  }
}
