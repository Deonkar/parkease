import { HttpException, HttpStatus } from '@nestjs/common';

/** Same contract as the other domain errors: `error` is the code, `message` is user copy. */
abstract class SpaceDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

/** An admin decision on a space that is no longer waiting for one. */
export class IllegalApprovalTransitionError extends SpaceDomainError {
  constructor() {
    super(
      'ILLEGAL_APPROVAL_TRANSITION',
      'That listing is not waiting for a decision.',
      HttpStatus.CONFLICT,
    );
  }
}

/** Rejected is terminal for the owner: the way forward is a new listing, not an edit. */
export class SpaceRejectedError extends SpaceDomainError {
  constructor() {
    super(
      'SPACE_REJECTED',
      'This listing was rejected and cannot be edited. Create a new listing instead.',
      HttpStatus.CONFLICT,
    );
  }
}
