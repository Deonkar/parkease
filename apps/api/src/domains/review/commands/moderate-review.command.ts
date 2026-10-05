import { Inject, Injectable } from '@nestjs/common';
import { recomputeRatingAggregate } from '@parkease/db/queries';
import { reviews } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { AuditService } from '../../../platform/observability/audit.service.js';
import { ReviewAlreadyRemovedError, ReviewNotFoundError } from '../errors.js';
import type { ReviewRecord } from '../review.service.js';
import { ReviewService } from '../review.service.js';

/** The admin, carried from the request: the audit row is written three layers down (R-SEC-10). */
export interface ModerationActor {
  readonly userId: string;
  readonly role: string;
  readonly ipAddress: string | null;
}

const reviewTargetTypeOf = (review: ReviewRecord) => {
  const { targetType } = review;
  if (
    targetType === 'space' ||
    targetType === 'driver' ||
    targetType === 'valet' ||
    targetType === 'washer'
  ) {
    return targetType;
  }
  throw new Error(`review ${review.id} has target_type ${targetType}`);
};

/**
 * Task 17 §17.10. Remove is a soft delete plus an audit row, and recomputes the target's read
 * model on the same transaction — removal is how an average moves with no new review, so the
 * audit row is the answer to "why did this rating go up". Dismiss keeps the review and clears
 * the flag; the average does not change.
 */
@Injectable()
export class ModerateReviewCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reviews: ReviewService,
    private readonly audit: AuditService,
  ) {}

  async remove(reviewId: string, actor: ModerationActor, reason: string): Promise<ReviewRecord> {
    return withTransaction(this.db, async (tx) => {
      const before = await this.reviews.findForUpdate(tx, reviewId);
      if (before === undefined) throw new ReviewNotFoundError();
      if (before.deletedAt !== null) throw new ReviewAlreadyRemovedError();

      const now = new Date();
      const [removed] = await tx
        .update(reviews)
        .set({
          moderationStatus: 'removed',
          removedByUserId: actor.userId,
          removedReason: reason,
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(reviews.id, reviewId))
        .returning();
      if (removed === undefined) throw new ReviewNotFoundError();

      await recomputeRatingAggregate(tx, reviewTargetTypeOf(before), before.targetId, now);

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'review.remove',
        targetType: 'review',
        targetId: reviewId,
        before,
        after: removed,
        ipAddress: actor.ipAddress,
      });

      return removed;
    });
  }

  async dismiss(reviewId: string, actor: ModerationActor): Promise<ReviewRecord> {
    return withTransaction(this.db, async (tx) => {
      const before = await this.reviews.findForUpdate(tx, reviewId);
      if (before === undefined) throw new ReviewNotFoundError();
      if (before.deletedAt !== null) throw new ReviewAlreadyRemovedError();

      const [dismissed] = await tx
        .update(reviews)
        .set({ isReported: false, updatedAt: new Date() })
        .where(eq(reviews.id, reviewId))
        .returning();
      if (dismissed === undefined) throw new ReviewNotFoundError();

      await this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'review.dismiss',
        targetType: 'review',
        targetId: reviewId,
        before,
        after: dismissed,
        ipAddress: actor.ipAddress,
      });

      return dismissed;
    });
  }
}
