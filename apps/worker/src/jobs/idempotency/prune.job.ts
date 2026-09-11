import { idempotencyKeys } from '@parkease/db/schema';
import { sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

export async function pruneIdempotencyKeys(deps: JobDeps): Promise<void> {
  const deleted = await deps.db
    .delete(idempotencyKeys)
    .where(sql`${idempotencyKeys.expiresAt} < now()`)
    .returning({ key: idempotencyKeys.key });

  if (deleted.length > 0) {
    logger.info({ count: deleted.length }, 'pruned expired idempotency keys');
  }
}
