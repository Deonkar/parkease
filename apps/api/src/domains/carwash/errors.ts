import { HttpException, HttpStatus } from '@nestjs/common';
import type { CarwashJobEvent, CarwashJobStatus } from '@parkease/contracts/enums';

/**
 * The exception filter builds `error.code` from the `error` field of an
 * HttpException's response body, so a domain failure that wants a stable
 * machine code has to set that field itself (see `domains/booking/errors.ts`).
 *
 * The message is the copy a driver or a partner reads (R-GEN-06). Nothing in it
 * names a constraint, a table or a status.
 */
export abstract class CarwashDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class IllegalCarwashTransitionError extends CarwashDomainError {
  constructor(
    readonly from: CarwashJobStatus,
    readonly event: CarwashJobEvent,
  ) {
    super(
      'ILLEGAL_CARWASH_TRANSITION',
      "This job can't be moved there from where it is now.",
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * The loser of the first-accept race. Two of every three partners offered a job
 * will see this, so the copy reads as a normal outcome rather than a failure.
 */
export class WashJobAlreadyTakenError extends CarwashDomainError {
  constructor() {
    super(
      'WASH_JOB_TAKEN',
      'This job was taken by another partner. More jobs coming!',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * §13. The one precondition this whole task turns on: the booking must be
 * `active`, which means the car is physically in the bay.
 *
 * v1 offered "Add Car Wash" on the booking *confirmation* screen — at
 * `confirmed`, before the car arrives. A wash for a car that has not arrived is
 * a charge that must be refunded and a partner dispatched to an empty slot.
 */
export class BookingNotWashEligibleError extends CarwashDomainError {
  constructor() {
    super(
      'BOOKING_NOT_WASH_ELIGIBLE',
      'Your car needs to be parked before we can arrange a wash.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class WashAlreadyRequestedError extends CarwashDomainError {
  constructor() {
    super(
      'WASH_ALREADY_REQUESTED',
      "There's already a wash on the way for this booking.",
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * §13.8. The server enforcing what the partner app also gates.
 *
 * A before/after pair is the only evidence either side has of what state the
 * car was in, so starting without the first photo is not a valid claim to have
 * started, and finishing without the second is not a valid claim to have
 * finished.
 */
export class BeforePhotoRequiredError extends CarwashDomainError {
  constructor() {
    super(
      'BEFORE_PHOTO_REQUIRED',
      'Take a photo of the car before you start.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class AfterPhotoRequiredError extends CarwashDomainError {
  constructor() {
    super(
      'AFTER_PHOTO_REQUIRED',
      'Add a photo of the finished car before you close the job.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * The partner does not price this service for this vehicle type.
 *
 * The candidate query already excludes them, so reaching this means the menu
 * row was deactivated between the offer and the accept — a real race, not a
 * client bug, which is why the copy explains rather than accuses.
 */
export class ServiceNotOfferedError extends CarwashDomainError {
  constructor() {
    super(
      'SERVICE_NOT_OFFERED',
      "You don't have a price set for this service and vehicle type any more.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * No activated Razorpay Linked Account, so there is nowhere to route this
 * partner's share when the driver pays (ADR-013).
 *
 * Refused at accept rather than at payment: taking the job first and
 * discovering it at checkout would mean a driver with a partner on the way and
 * no way to pay them.
 */
export class WasherNotOnboardedError extends CarwashDomainError {
  constructor() {
    super(
      'WASHER_NOT_ONBOARDED',
      'Finish your payout setup before taking jobs, so we can pay you for them.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class WasherProfileNotFoundError extends CarwashDomainError {
  constructor() {
    super(
      'WASHER_PROFILE_NOT_FOUND',
      'Finish setting up your partner profile before going online.',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class WasherProfileExistsError extends CarwashDomainError {
  constructor() {
    super('WASHER_PROFILE_EXISTS', "You've already registered as a partner.", HttpStatus.CONFLICT);
  }
}

export class WasherNotVerifiedError extends CarwashDomainError {
  constructor() {
    super(
      'WASHER_NOT_VERIFIED',
      'Your documents are still being checked. You can go online once they clear.',
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * The wash has no price yet, so there is nothing to charge for.
 *
 * Reached when a driver asks for a payment order before any partner has
 * accepted: the amount comes from the winning partner's own menu, and until
 * somebody wins there is no menu to read.
 */
export class WashNotPayableError extends CarwashDomainError {
  constructor() {
    super(
      'WASH_NOT_PAYABLE',
      "We're still finding a partner. You can pay once somebody takes the job.",
      HttpStatus.BAD_REQUEST,
    );
  }
}
