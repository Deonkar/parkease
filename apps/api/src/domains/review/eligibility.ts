import { NotFoundException } from '@nestjs/common';
import type { ReviewTargetType } from '@parkease/contracts/enums';

import {
  BookingNotCompletedError,
  CommentTooLongError,
  ReviewWindowClosedError,
  SelfReviewError,
} from './errors.js';

export const REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_COMMENT_LENGTH = 500;

export interface Counterparty {
  readonly userId: string;
  readonly name: string | null;
}

/** Everyone on a booking who can be reviewed, resolved by `ReviewService.participantsOf`. */
export interface Participants {
  readonly booking: {
    readonly id: string;
    readonly status: string;
    readonly completedAt: Date | null;
    readonly driverId: string;
    readonly spaceId: string;
    readonly spaceTitle: string;
    readonly ownerId: string;
  };
  /** Assigned to a COMPLETED job on this booking. A cancelled valet did no work to review. */
  readonly valets: readonly Counterparty[];
  readonly washers: readonly Counterparty[];
}

export type ReviewerRole = 'driver' | 'owner';

export interface ReviewContext {
  readonly participants: Participants;
  readonly reviewerUserId: string;
  readonly reviewerRole: ReviewerRole;
  readonly targetType: ReviewTargetType;
  readonly targetId: string;
  /** Already sanitised. */
  readonly comment: string | null;
  readonly now: Date;
}

const notFound = (): NotFoundException => new NotFoundException('Booking not found.');

/** The counterparties each reviewer role may review on this booking (v1: drivers and owners). */
function isTargetOnBooking(ctx: ReviewContext): boolean {
  const { booking, valets, washers } = ctx.participants;
  if (ctx.reviewerRole === 'owner') {
    return ctx.targetType === 'driver' && ctx.targetId === booking.driverId;
  }
  switch (ctx.targetType) {
    case 'space':
      return ctx.targetId === booking.spaceId;
    case 'valet':
      return valets.some((v) => v.userId === ctx.targetId);
    case 'washer':
      return washers.some((w) => w.userId === ctx.targetId);
    case 'driver':
      return false;
  }
}

/**
 * Task 17 §17.4, pure so it is unit-tested without a database. One review per counterparty per
 * booking is NOT here: `reviews_one_per_counterparty_per_booking` enforces it, and an application
 * check would still race.
 *
 * Order matters for one rule: a stranger is answered 404 before anything is said about the
 * booking's status, so the endpoint cannot be used to learn whether a booking finished (R-SEC-04).
 * The integer 1..5 rule is the Zod contract's.
 */
export function assertReviewable(ctx: ReviewContext): void {
  const { booking } = ctx.participants;

  const reviewerIsOnBooking =
    ctx.reviewerRole === 'driver'
      ? booking.driverId === ctx.reviewerUserId
      : booking.ownerId === ctx.reviewerUserId;
  if (!reviewerIsOnBooking) throw notFound();

  if (booking.status !== 'completed' || booking.completedAt === null) {
    throw new BookingNotCompletedError();
  }

  if (ctx.now.getTime() > booking.completedAt.getTime() + REVIEW_WINDOW_MS) {
    throw new ReviewWindowClosedError();
  }

  if (ctx.targetId === ctx.reviewerUserId) throw new SelfReviewError();

  if (!isTargetOnBooking(ctx)) throw notFound();

  // Code points, as PG's char_length counts them: `.length` counts UTF-16 units, so an emoji
  // comment the database would accept would be refused here at half its real length.
  if (ctx.comment !== null && [...ctx.comment].length > MAX_COMMENT_LENGTH) {
    throw new CommentTooLongError();
  }
}
