import { HttpException, HttpStatus } from '@nestjs/common';

/** Same contract as the other domain errors: `error` is the code, `message` is user copy. */
abstract class ReviewDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class BookingNotCompletedError extends ReviewDomainError {
  constructor() {
    super(
      'BOOKING_NOT_COMPLETED',
      'You can review a booking once it has finished.',
      HttpStatus.CONFLICT,
    );
  }
}

export class ReviewWindowClosedError extends ReviewDomainError {
  constructor() {
    super(
      'REVIEW_WINDOW_CLOSED',
      'Reviews close seven days after a booking ends.',
      HttpStatus.CONFLICT,
    );
  }
}

export class SelfReviewError extends ReviewDomainError {
  constructor() {
    super('SELF_REVIEW', "You can't review yourself.", HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CommentTooLongError extends ReviewDomainError {
  constructor() {
    super(
      'COMMENT_TOO_LONG',
      'Keep your comment to 500 characters.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ReviewNotFoundError extends ReviewDomainError {
  constructor() {
    super('REVIEW_NOT_FOUND', 'That review does not exist.', HttpStatus.NOT_FOUND);
  }
}

export class ResponseAlreadyExistsError extends ReviewDomainError {
  constructor() {
    super(
      'RESPONSE_ALREADY_EXISTS',
      "You've already responded to this review.",
      HttpStatus.CONFLICT,
    );
  }
}

export class ReviewAlreadyRemovedError extends ReviewDomainError {
  constructor() {
    super('REVIEW_ALREADY_REMOVED', 'That review was already removed.', HttpStatus.CONFLICT);
  }
}

/**
 * A driver may report only reviews of spaces they have booked (S-129). Every report is admin time,
 * and a review needs no relationship to report, so a fleet of fresh accounts could flood the queue.
 */
export class ReportNeedsBookingError extends ReviewDomainError {
  constructor() {
    super(
      'REPORT_NEEDS_BOOKING',
      "You can report reviews of spaces you've parked at.",
      HttpStatus.FORBIDDEN,
    );
  }
}
