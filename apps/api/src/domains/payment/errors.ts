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

/**
 * An admin refund asked for more than is left, or for nothing at all. 422 rather than 400: the
 * body parsed, and it is the booking's balance — read under the payment lock — that refuses it.
 * A malformed body is still 400 `VALIDATION_FAILED` from the filter (task 18a ruling).
 */
export class RefundExceedsBalanceError extends PaymentDomainError {
  constructor() {
    super(
      'REFUND_EXCEEDS_BALANCE',
      'That refund is more than is left to refund on this booking.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** The booking was never paid for, so there is no money at the gateway to send back. */
export class NoCapturedPaymentError extends PaymentDomainError {
  constructor() {
    super(
      'NO_CAPTURED_PAYMENT',
      'This booking has no captured payment to refund.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * An admin refund on a booking that is still live. Cancelling is the refund for an upcoming or
 * running booking: it releases the slot and refunds by the published tier, whereas a partial
 * refund here would leave a confirmed booking whose later cancellation refunds it a second time.
 */
export class BookingNotSettledError extends PaymentDomainError {
  constructor() {
    super(
      'BOOKING_NOT_SETTLED',
      'Refund a booking once it has finished. To refund a live booking, cancel it.',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Not an HttpException, deliberately: a live (confirmed or active) booking whose parking payment
 * is anything but `captured` cannot happen — admin refunds wait until a booking is over, and the
 * orphan job's payments are excluded from the lookup. If it ever does, cancelling would refund
 * the full total a second time, so it reaches the filter unmapped: a 500, logged at error with
 * the trace id and these ids (R-FAIL-01).
 */
export class LiveBookingPaymentNotCapturedError extends Error {
  constructor(
    readonly bookingId: string,
    readonly paymentId: string,
    readonly paymentStatus: string,
  ) {
    super(
      `Booking ${bookingId} is live but its parking payment ${paymentId} is ${paymentStatus}; ` +
        'refusing to cancel and refund it again',
    );
    this.name = 'LiveBookingPaymentNotCapturedError';
  }
}
