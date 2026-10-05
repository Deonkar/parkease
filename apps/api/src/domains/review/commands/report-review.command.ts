import { Inject, Injectable } from '@nestjs/common';
import type { ReviewReportReason } from '@parkease/contracts/enums';
import { reviewReports, reviews } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { ReviewNotFoundError } from '../errors.js';
import { ReviewService } from '../review.service.js';

export interface ReportReviewInput {
  readonly reviewId: string;
  readonly reporterUserId: string;
  /** Set for an owner: they may report only reviews about their own spaces. */
  readonly ownerId?: string;
  readonly reason: ReviewReportReason;
  readonly detail?: string | undefined;
}

/**
 * Task 17 §17.10. Reporting flags; it never hides. Silent removal on report would hand every
 * owner a button that deletes their bad reviews. The review stays public until an admin acts.
 */
@Injectable()
export class ReportReviewCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reviews: ReviewService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: ReportReviewInput): Promise<void> {
    const review =
      input.ownerId === undefined
        ? await this.reviews.findVisible(input.reviewId)
        : await this.reviews.findOnOwnersSpace(input.reviewId, input.ownerId);
    if (review === undefined) throw new ReviewNotFoundError();

    await withTransaction(this.db, async (tx) => {
      // 23505 on review_reports_one_per_reporter → 409 REVIEW_ALREADY_REPORTED.
      await tx.insert(reviewReports).values({
        reviewId: review.id,
        reporterUserId: input.reporterUserId,
        reason: input.reason,
        detail: input.detail ?? null,
      });

      // Denormalised so the moderation queue is a partial-index scan.
      await tx
        .update(reviews)
        .set({ isReported: true, updatedAt: new Date() })
        .where(eq(reviews.id, review.id));

      await this.outbox.enqueue(tx, {
        type: 'review.reported',
        payload: { reviewId: review.id, reason: input.reason },
      });
    });
  }
}
