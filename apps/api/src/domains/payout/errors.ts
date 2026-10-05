import { HttpException, HttpStatus } from '@nestjs/common';

/** Same contract as the other domain errors: `error` is the code, `message` is user copy. */
abstract class PayoutDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class BankDetailsRejectedError extends PayoutDomainError {
  constructor() {
    super(
      'BANK_DETAILS_REJECTED',
      "The bank didn't accept those details. Check the account number and IFSC and try again.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class PayoutProviderUnavailableError extends PayoutDomainError {
  constructor() {
    super(
      'PAYOUT_PROVIDER_UNAVAILABLE',
      "We couldn't save your bank details just now. Nothing has changed — please try again shortly.",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class BankDetailsNotFoundError extends PayoutDomainError {
  constructor() {
    super('BANK_DETAILS_NOT_FOUND', "You haven't added bank details yet.", HttpStatus.NOT_FOUND);
  }
}

export class PayoutNotFoundError extends PayoutDomainError {
  constructor() {
    super('PAYOUT_NOT_FOUND', 'That payout does not exist.', HttpStatus.NOT_FOUND);
  }
}

export class RouteOnboardingLockedError extends PayoutDomainError {
  constructor() {
    super(
      'ROUTE_ONBOARDING_LOCKED',
      'Your details are with Razorpay already. To change them, contact support.',
      HttpStatus.CONFLICT,
    );
  }
}

export class RouteDetailsRejectedError extends PayoutDomainError {
  constructor() {
    super(
      'ROUTE_DETAILS_REJECTED',
      "Razorpay couldn't accept these details. Check your PAN and bank account, then try again.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class RouteOnboardingNotFoundError extends PayoutDomainError {
  constructor() {
    super('ROUTE_ONBOARDING_NOT_FOUND', "You haven't set up payouts yet.", HttpStatus.NOT_FOUND);
  }
}
