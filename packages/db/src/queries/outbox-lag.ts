import { sql } from 'drizzle-orm';

/** How long the oldest ready outbox message may wait before it is late (§21.3, S-156). */
export const OUTBOX_LAG_BUDGET_SECONDS = 30;

/**
 * Seconds the oldest ready message has been waiting, NULL when none is. A message held back by
 * retry backoff is not ready, so it does not count: that wait is deliberate.
 *
 * One query for both readers: the worker's relay, which alerts on it, and the API's
 * `/health/pipeline`, which reports it from outside the worker so a dead worker is noticed.
 */
export const OUTBOX_LAG_SECONDS = sql<number | null>`
  SELECT extract(epoch FROM now() - min(available_at))::float8 AS lag
  FROM outbox_messages
  WHERE status = 'pending' AND available_at <= now()
`;
