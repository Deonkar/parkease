import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ReviewTargetType } from '@parkease/contracts/enums';
import { recomputeRatingAggregate } from '@parkease/db/queries';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import { assertReviewable } from '../eligibility.js';
import { ReviewService, type ReviewRow } from '../review.service.js';
import { sanitiseComment } from '../sanitise.js';

interface CreateReviewBase {
  readonly reviewerUserId: string;
  readonly bookingId: string;
  readonly rating: number;
  readonly comment?: string | undefined;
}

/** A driver names the counterparty; an owner always reviews the booking's driver. */
export type CreateReviewInput = CreateReviewBase &
  (
    | {
        readonly reviewerRole: 'driver';
        readonly targetType: Exclude<ReviewTargetType, 'driver'>;
        readonly targetId: string;
      }
    | { readonly reviewerRole: 'owner' }
  );

/**
 * Task 17 §17.6. The review, the target's read model and the outbox event commit together
 * (rule 3); the read model is recomputed under a row lock, never incremented.
 */
@Injectable()
export class CreateReviewCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reviews: ReviewService,
    private readonly outbox: OutboxService,
  ) {}

  async execute(input: CreateReviewInput): Promise<ReviewRow> {
    const participants = await this.reviews.participantsOf(input.bookingId);
    if (participants === undefined) throw new NotFoundException('Booking not found.');

    const target =
      input.reviewerRole === 'owner'
        ? { targetType: 'driver' as const, targetId: participants.booking.driverId }
        : { targetType: input.targetType, targetId: input.targetId };
    const comment = sanitiseComment(input.comment ?? null);

    assertReviewable({
      participants,
      reviewerUserId: input.reviewerUserId,
      reviewerRole: input.reviewerRole,
      ...target,
      comment,
      now: new Date(),
    });

    // Read before the write: a failure after commit would answer 500 for a review that exists.
    const reviewerName = await this.reviews.nameOf(input.reviewerUserId);

    const review = await withTransaction(this.db, async (tx) => {
      // 23505 on reviews_one_per_counterparty_per_booking → 409 REVIEW_ALREADY_EXISTS.
      const inserted = await this.reviews.insert(tx, {
        bookingId: participants.booking.id,
        reviewerUserId: input.reviewerUserId,
        reviewerRole: input.reviewerRole,
        ...target,
        rating: input.rating,
        comment,
      });

      await recomputeRatingAggregate(tx, target.targetType, target.targetId);

      await this.outbox.enqueue(tx, {
        type: 'review.created',
        payload: { reviewId: inserted.id, ...target, rating: input.rating },
      });

      return inserted;
    });

    return { review, reviewerName };
  }
}
