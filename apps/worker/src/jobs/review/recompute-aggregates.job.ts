import { ageingReviewTargets, recomputeRatingAggregate } from '@parkease/db/queries';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

export const REVIEW_RECOMPUTE_AGGREGATES_JOB = 'review.recompute-aggregates';

/**
 * Task 17 §17.6. A review's weight halves when it turns 30 days old, and no write happens that
 * day — so recompute-on-write alone drifts. Nightly, this recomputes the targets with a review that
 * crossed the window in the last week, through the same function the API's writes use.
 *
 * Idempotent: recomputing a correct aggregate writes the same value (R-ASYNC-03). One transaction
 * per target, and one bad target does not stop the rest: each failure is logged with its target,
 * and the job still fails at the end so pg-boss retries it and the failure is visible (R-FAIL-01).
 */
export async function recomputeAgeingAggregates(
  deps: JobDeps,
  now: Date = new Date(),
): Promise<void> {
  const targets = await ageingReviewTargets(deps.db, now);
  let failed = 0;

  for (const target of targets) {
    try {
      await deps.db.transaction((tx) =>
        recomputeRatingAggregate(tx, target.targetType, target.targetId, now),
      );
    } catch (err) {
      failed += 1;
      logger.warn({ err, ...target }, 'review.recompute-aggregates: target failed');
    }
  }

  if (failed > 0) {
    throw new Error(
      `review.recompute-aggregates: ${String(failed)} of ${String(targets.length)} failed`,
    );
  }
  logger.info({ targets: targets.length }, 'review.recompute-aggregates: done');
}
