import { HttpException, HttpStatus } from '@nestjs/common';
import type { ValetJobEvent, ValetJobStatus } from '@parkease/contracts/enums';

/**
 * The exception filter builds `error.code` from the `error` field of an
 * HttpException's response body, so a domain failure that wants a stable machine
 * code has to set that field itself (see `domains/booking/errors.ts`).
 *
 * The message is the copy a driver or a valet reads (R-GEN-06). Nothing in it
 * names a constraint, a table or a status.
 */
export abstract class ValetDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class IllegalValetTransitionError extends ValetDomainError {
  constructor(
    readonly from: ValetJobStatus,
    readonly event: ValetJobEvent,
  ) {
    super(
      'ILLEGAL_VALET_TRANSITION',
      "This job can't be moved there from where it is now.",
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * The loser of the first-accept race. §11.5 fixes this copy verbatim from
 * website.md §6, and the second sentence is why it reads as normal rather than
 * as a failure — four of every five valets who try will see it.
 */
export class JobAlreadyTakenError extends ValetDomainError {
  constructor() {
    super(
      'VALET_JOB_TAKEN',
      'This job was taken by another valet. More jobs coming!',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * `pending_payment` is excluded deliberately: dispatching a valet against an
 * unpaid hold means the expiry job can cancel the booking while a valet is
 * mid-journey (prd.md §7.1).
 */
export class BookingNotValetEligibleError extends ValetDomainError {
  constructor() {
    super(
      'BOOKING_NOT_VALET_ELIGIBLE',
      'Pay for your booking first, then request a valet.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ValetAlreadyRequestedError extends ValetDomainError {
  constructor() {
    super(
      'VALET_ALREADY_REQUESTED',
      'A valet is already on the way for this booking.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * From `parking` onward a stranger has the driver's keys. Cancelling is a
 * support path with a human in it, not a POST — so the message names that path
 * rather than telling the driver to try again.
 */
export class ValetHoldsVehicleError extends ValetDomainError {
  constructor() {
    super(
      'VALET_HOLDS_VEHICLE',
      'Your valet has your car right now, so this cannot be cancelled here. ' +
        'Contact support and we will sort it out with them.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * The server enforcing what task 12 also gates in the client. A parked-car photo
 * is the only evidence the driver has of where their car went and what state it
 * was in, so "confirm parked" without one is not a valid claim to have parked it.
 */
export class ProofPhotoRequiredError extends ValetDomainError {
  constructor() {
    super(
      'PROOF_PHOTO_REQUIRED',
      'Add a photo of the parked car before you finish.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ValetProfileNotFoundError extends ValetDomainError {
  constructor() {
    super(
      'VALET_PROFILE_NOT_FOUND',
      'Finish setting up your valet profile before going online.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ValetNotVerifiedError extends ValetDomainError {
  constructor() {
    super(
      'VALET_NOT_VERIFIED',
      'Your documents are still being checked. You can go online once they clear.',
      HttpStatus.FORBIDDEN,
    );
  }
}
