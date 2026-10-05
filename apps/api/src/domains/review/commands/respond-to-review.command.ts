import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { reviews, spaces } from '@parkease/db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { ResponseAlreadyExistsError, ReviewNotFoundError } from '../errors.js';
import { ReviewService, type ReviewRecord } from '../review.service.js';
import { sanitiseComment } from '../sanitise.js';

export interface RespondToReviewInput {
  readonly reviewId: string;
  readonly ownerId: string;
  readonly response: string;
}

/**
 * One public response per review, by the owner of the space it is about. A single conditional
 * UPDATE, so two taps cannot both respond: the second matches no row.
 */
@Injectable()
export class RespondToReviewCommand {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly reviews: ReviewService,
  ) {}

  async execute(input: RespondToReviewInput): Promise<ReviewRecord> {
    // Public text, so the same normalisation as a review comment.
    const response = sanitiseComment(input.response);
    if (response === null) {
      throw new BadRequestException({
        error: 'RESPONSE_EMPTY',
        message: 'Write a response first.',
      });
    }

    const now = new Date();
    const ownSpaces = this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.ownerId, input.ownerId));

    const [updated] = await this.db
      .update(reviews)
      .set({ ownerResponse: response, ownerRespondedAt: now, updatedAt: now })
      .where(
        and(
          eq(reviews.id, input.reviewId),
          eq(reviews.targetType, 'space'),
          inArray(reviews.targetId, ownSpaces),
          isNull(reviews.ownerResponse),
          isNull(reviews.deletedAt),
        ),
      )
      .returning();
    if (updated !== undefined) return updated;

    // No row: either not theirs (404, never confirm it exists) or already answered (409).
    const existing = await this.reviews.findOnOwnersSpace(input.reviewId, input.ownerId);
    if (existing === undefined) throw new ReviewNotFoundError();
    throw new ResponseAlreadyExistsError();
  }
}
