import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The exception filter builds `error.code` from the `error` field of an
 * HttpException's response body, so a domain failure that wants a stable machine
 * code has to set that field itself. `new ConflictException('SLOT_UNAVAILABLE')`
 * does not: it yields code `CONFLICT` with the machine string leaking into the
 * user-facing message.
 *
 * The message is the copy a driver reads (R-GEN-06). Nothing in it names a
 * constraint, a table or a status — that detail belongs in the log line the
 * filter writes alongside the trace id.
 */
export abstract class BookingDomainError extends HttpException {
  protected constructor(code: string, message: string, status: HttpStatus) {
    super({ error: code, message }, status);
  }
}

export class SlotUnavailableError extends BookingDomainError {
  constructor() {
    super(
      'SLOT_UNAVAILABLE',
      'This spot was just booked by someone else. Try another one!',
      HttpStatus.CONFLICT,
    );
  }
}

export class ExtensionConflictError extends BookingDomainError {
  constructor() {
    super(
      'EXTENSION_CONFLICT',
      "This spot is booked right after you, so we can't extend your time. " +
        'Try booking a different spot.',
      HttpStatus.CONFLICT,
    );
  }
}

export class SpaceNotBookableError extends BookingDomainError {
  constructor() {
    super(
      'SPACE_NOT_BOOKABLE',
      'This space is not taking bookings right now.',
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidBookingWindowError extends BookingDomainError {
  constructor(message: string) {
    super('INVALID_BOOKING_WINDOW', message, HttpStatus.BAD_REQUEST);
  }
}

export class InvalidBookingReferenceError extends BookingDomainError {
  constructor() {
    super(
      'INVALID_BOOKING_REFERENCE',
      "That QR code isn't valid. Ask the driver to reopen their booking.",
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ExpiredBookingReferenceError extends BookingDomainError {
  constructor() {
    super(
      'EXPIRED_BOOKING_REFERENCE',
      'That QR code has expired. Ask the driver to reopen their booking.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class CheckInTooEarlyError extends BookingDomainError {
  constructor() {
    super(
      'CHECK_IN_TOO_EARLY',
      'You can check yourself in 10 minutes after your booking starts, ' +
        'if the owner has not scanned you in by then.',
      HttpStatus.CONFLICT,
    );
  }
}

export class PriceUnavailableError extends BookingDomainError {
  constructor(message: string) {
    super('PRICE_UNAVAILABLE', message, HttpStatus.CONFLICT);
  }
}
