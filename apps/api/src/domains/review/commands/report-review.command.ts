import { Inject, Injectable } from '@nestjs/common';
import type { ReviewReportReason } from '@parkease/contracts/enums';
import { bookings, reviewReports, reviews } from '@parkease/db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { ReportNeedsBookingError, ReviewNotFoundError } from '../errors.js';
import { ReviewService } from '../review.service.js';
import { sanitiseComment } from '../sanitise.js';

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
    // A driver reports what they can read — reviews of spaces. Reviews of drivers, valets and
    // washers are not public, so for a driver they do not exist (404, not a confirmation).
    const review =
      input.ownerId === undefined
        ? await this.reviews.findVisible(input.reviewId)
        : await this.reviews.findOnOwnersSpace(input.reviewId, input.ownerId);
    if (review === undefined || review.targetType !== 'space') throw new ReviewNotFoundError();

    // A driver reports only spaces they have actually parked at (S-129): a report must cost more
    // than a fresh account. An owner is already limited to reviews of their own spaces.
    if (
      input.ownerId === undefined &&
      !(await this.hasBooked(input.reporterUserId, review.targetId))
    ) {
      throw new ReportNeedsBookingError();
    }

    await withTransaction(this.db, async (tx) => {
      // Denormalised so the moderation queue is a partial-index scan. Conditional on the review
      // still standing: an admin may have removed it since the read above, and a report on a
      // removed review would land nowhere. Zero rows throws, which rolls the report back.
      const flagged = await tx
        .update(reviews)
        .set({ isReported: true, updatedAt: new Date() })
        .where(and(eq(reviews.id, review.id), isNull(reviews.deletedAt)))
        .returning({ id: reviews.id });
      if (flagged.length === 0) throw new ReviewNotFoundError();

      // 23505 on review_reports_one_per_reporter → 409 REVIEW_ALREADY_REPORTED.
      await tx.insert(reviewReports).values({
        reviewId: review.id,
        reporterUserId: input.reporterUserId,
        reason: input.reason,
        detail: sanitiseComment(input.detail ?? null),
      });

      await this.outbox.enqueue(tx, {
        type: 'review.reported',
        payload: { reviewId: review.id, reason: input.reason },
      });
    });
  }

  /** A booking that was real: paid for at some point, not an abandoned or expired hold. */
  private async hasBooked(driverId: string, spaceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.driverId, driverId),
          eq(bookings.spaceId, spaceId),
          inArray(bookings.status, ['confirmed', 'active', 'completed', 'no_show']),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
