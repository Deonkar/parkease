import type { ReviewTargetType } from '@parkease/contracts/enums';
import {
  RECENCY_WINDOW_MS,
  type RatingBp,
  weightedAverageBp,
} from '@parkease/contracts/primitives';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database, Transaction } from '../client.js';
import { reviews, spaces, valetProfiles, washerProfiles } from '../schema/index.js';

/**
 * Where each target's read model lives, and the column its `target_id` matches. Valets and
 * washers are reviewed as people, so their `target_id` is the partner's users.id.
 */
const READ_MODELS = {
  space: { table: spaces, key: spaces.id },
  valet: { table: valetProfiles, key: valetProfiles.userId },
  washer: { table: washerProfiles, key: washerProfiles.userId },
} as const;

export interface RatingAggregate {
  readonly ratingAvgBp: RatingBp | null;
  readonly ratingCount: number;
}

/**
 * Recomputes a target's read model from every visible review and writes it. Recomputed, never
 * incremented: an increment cannot express recency weighting, and drifts the moment one write is
 * lost. Shared by the API (inside every review write's transaction) and the worker's nightly
 * recompute, so the two cannot disagree (R-ARCH-07).
 *
 * The read-model row is locked FIRST. Two reviews of one space committing at once each see only
 * their own insert under READ COMMITTED, so without the lock the later commit overwrites the
 * earlier one's count. With it, the second waits, and its SELECT — a new statement — sees the
 * first's committed row.
 *
 * Drivers have no read model (task 17a): nothing reads a driver rating yet.
 */
export async function recomputeRatingAggregate(
  tx: Transaction,
  targetType: ReviewTargetType,
  targetId: string,
  now: Date = new Date(),
): Promise<RatingAggregate> {
  if (targetType === 'driver') return { ratingAvgBp: null, ratingCount: 0 };

  const { table, key } = READ_MODELS[targetType];

  await tx.select({ id: key }).from(table).where(eq(key, targetId)).for('update');

  const rows = await tx
    .select({ rating: reviews.rating, createdAt: reviews.createdAt })
    .from(reviews)
    .where(
      and(
        eq(reviews.targetType, targetType),
        eq(reviews.targetId, targetId),
        eq(reviews.moderationStatus, 'visible'),
        isNull(reviews.deletedAt),
      ),
    );

  const aggregate = { ratingAvgBp: weightedAverageBp(rows, now), ratingCount: rows.length };

  // Raw because `tx.update()` over a union of three tables is too deep for the type checker; the
  // three share these column names (0003, 0026, 0027).
  await tx.execute(sql`
    UPDATE ${table}
    SET rating_avg_bp = ${aggregate.ratingAvgBp},
        rating_count = ${aggregate.ratingCount},
        updated_at = ${now.toISOString()}::timestamptz
    WHERE ${key} = ${targetId}
  `);

  return aggregate;
}

// A local enum, not contracts' `reviewTargetTypeSchema`: this package pins a different zod patch,
// and a schema from the other instance sends the type checker into infinite instantiation.
const ageingTargetSchema = z.object({
  target_type: z.enum(['space', 'valet', 'washer']),
  target_id: z.string().uuid(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Targets with a review that crossed the 30-day recency window in the last day. Its weight
 * changed with no write to recompute it, so the nightly job does. One day's ageing reviews, not
 * a full-table rebuild; a missed night is caught by the next only if it runs within a day, which
 * is why the window here is a day wide and the job runs daily.
 */
export async function ageingReviewTargets(
  db: Database,
  now: Date = new Date(),
): Promise<{ targetType: Exclude<ReviewTargetType, 'driver'>; targetId: string }[]> {
  const newest = new Date(now.getTime() - RECENCY_WINDOW_MS).toISOString();
  const oldest = new Date(now.getTime() - RECENCY_WINDOW_MS - DAY_MS).toISOString();

  const rows = await db.execute(sql`
    SELECT DISTINCT target_type, target_id
    FROM reviews
    WHERE deleted_at IS NULL
      AND moderation_status = 'visible'
      AND target_type <> 'driver'
      AND created_at >= ${oldest}::timestamptz
      AND created_at <  ${newest}::timestamptz
  `);

  return z
    .array(ageingTargetSchema)
    .parse(Array.from(rows))
    .map((row) => ({ targetType: row.target_type, targetId: row.target_id }));
}
