import { ageingReviewTargets, recomputeRatingAggregate } from '@parkease/db/queries';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

export const REVIEW_RECOMPUTE_AGGREGATES_JOB = 'review.recompute-aggregates';

/**
 * Task 17 §17.6. A review's weight halves when it turns 30 days old, and no write happens that
 * day — so recompute-on-write alone drifts. Nightly, this recomputes only the targets with a
 * review that crossed the window in the last day, through the same function the API's writes use.
 *
 * Idempotent: recomputing a correct aggregate writes the same value (R-ASYNC-03). One transaction
 * per target, so one failure leaves the rest done; no catch, so a failure fails the pg-boss job,
 * which retries and is visible (R-FAIL-01).
 */
export async function recomputeAgeingAggregates(
  deps: JobDeps,
  now: Date = new Date(),
): Promise<void> {
  const targets = await ageingReviewTargets(deps.db, now);

  for (const target of targets) {
    await deps.db.transaction((tx) =>
      recomputeRatingAggregate(tx, target.targetType, target.targetId, now),
    );
  }

  logger.info({ targets: targets.length }, 'review.recompute-aggregates: done');
}
