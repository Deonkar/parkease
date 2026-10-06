import { HttpException, HttpStatus } from '@nestjs/common';

/** Same contract as the other domain errors: `error` is the code, `message` is user copy. */
abstract class IdentityDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

/** An admin grant of a role the user already holds, or is already waiting on. */
export class RoleAlreadyHeldError extends IdentityDomainError {
  constructor() {
    super('ROLE_ALREADY_HELD', 'That user already has this role.', HttpStatus.CONFLICT);
  }
}

/** An admin revoke of a role the user does not hold (never had it, or already lost it). */
export class RoleNotHeldError extends IdentityDomainError {
  constructor() {
    super('ROLE_NOT_HELD', 'That user does not have this role.', HttpStatus.NOT_FOUND);
  }
}

/**
 * An admin turning their own access off: revoking their own admin role or blocking themselves.
 * Refused because the way back is another admin, and there may not be one.
 */
export class SelfDemotionError extends IdentityDomainError {
  constructor() {
    super(
      'SELF_DEMOTION',
      "You can't remove your own admin access. Ask another admin to do it.",
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Verify and reject decide a profile that is waiting on a decision. One that was already decided
 * (by another admin a moment ago) or never submitted its documents is not.
 */
export class IllegalVerificationTransitionError extends IdentityDomainError {
  constructor() {
    super(
      'ILLEGAL_VERIFICATION_TRANSITION',
      "This partner isn't waiting on a verification decision.",
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Block needs an active user and unblock needs a blocked one. A deleted user is neither: letting
 * unblock through would bring a deleted account back to life.
 */
export class IllegalUserStatusTransitionError extends IdentityDomainError {
  constructor() {
    super(
      'ILLEGAL_USER_STATUS_TRANSITION',
      "That account's status doesn't allow this action.",
      HttpStatus.CONFLICT,
    );
  }
}
