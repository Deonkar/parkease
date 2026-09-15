import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Same contract as `BookingDomainError`: the filter builds `error.code` from the
 * `error` field, and the message is copy a driver reads (R-GEN-06). Nothing here
 * names a Razorpay id, a constraint or an amount — a payment failure is the last
 * place to leak detail into a response body.
 */
abstract class PaymentDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class OwnerNotOnboardedError extends PaymentDomainError {
  constructor() {
    // 409 rather than a silent order with no transfer attached. A captured
    // payment with no split becomes a manual payout nobody scheduled, and the
    // owner finds out when their money does not arrive.
    super(
      'OWNER_NOT_ONBOARDED',
      "This space can't take payments yet. Try another one — we're on it.",
      HttpStatus.CONFLICT,
    );
  }
}

export class AmountMismatchError extends PaymentDomainError {
  constructor() {
    super(
      'AMOUNT_MISMATCH',
      "We couldn't confirm that payment. Nothing has been charged — please try again.",
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InvalidWebhookSignatureError extends PaymentDomainError {
  constructor() {
    // The body of a 401 here is read by Razorpay's delivery machinery, not a
    // person. It says nothing about why, because the only caller who benefits
    // from knowing why is one forging signatures (R-SEC-03).
    super('INVALID_SIGNATURE', 'Unauthorized.', HttpStatus.UNAUTHORIZED);
  }
}

export class PaymentNotFoundError extends PaymentDomainError {
  constructor() {
    super('PAYMENT_NOT_FOUND', 'We could not find that payment.', HttpStatus.NOT_FOUND);
  }
}

export class BookingNotPayableError extends PaymentDomainError {
  constructor() {
    super(
      'BOOKING_NOT_PAYABLE',
      'This booking is no longer waiting for payment.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Not an HttpException, deliberately.
 *
 * Route refuses any payment whose transfers exceed the captured amount. Ours is
 * `base − 15%` against `base + surge + GST`, so it always clears — which means
 * that if this ever throws, the fee model has changed underneath us and a
 * request-shaped 4xx would be a lie. It reaches the filter unmapped and becomes
 * a 500, which is the correct outcome for our own arithmetic being wrong
 * (R-FAIL-01).
 */
export class TransferExceedsCaptureError extends Error {
  constructor(transferredPaise: number, capturedPaise: number) {
    super(
      `Route transfers total ${String(transferredPaise)} paise against a capture of ` +
        `${String(capturedPaise)} paise. Razorpay would reject this order.`,
    );
    this.name = 'TransferExceedsCaptureError';
  }
}
