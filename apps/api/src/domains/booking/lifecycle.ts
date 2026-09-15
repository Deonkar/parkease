import { HttpException, HttpStatus } from '@nestjs/common';
import { type BookingStatus, BookingStatus as Status } from '@parkease/contracts/enums';

export const BOOKING_EVENT_VALUES = [
  'pay',
  'payment_timeout',
  'check_in',
  'complete',
  'cancel',
] as const;

export type BookingEvent = (typeof BOOKING_EVENT_VALUES)[number];

export const BookingEvent = {
  PAY: 'pay',
  PAYMENT_TIMEOUT: 'payment_timeout',
  CHECK_IN: 'check_in',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
} as const satisfies Record<string, BookingEvent>;

/**
 * The complete set of legal transitions. Nothing else is reachable.
 *
 *   pending_payment ──pay──────────▶ confirmed ──check_in──▶ active ──complete──▶ completed
 *          │                            │                      │
 *          └──payment_timeout──▶ cancelled ◀──cancel───────────┴──cancel
 *
 * `active --cancel--> cancelled` is here deliberately: prd.md §8 defines a 50%
 * refund tier for cancelling "within the first 30 minutes of an active booking",
 * and that tier is unreachable without this edge.
 *
 * `expired` and `no_show` are in the `bookings_status_check` CHECK constraint but
 * have no inbound edge, so no code path can reach them. They are listed as
 * terminal rather than omitted: `Record<BookingStatus, …>` makes the table
 * exhaustive, so adding a status to the enum without deciding its transitions is
 * a type error rather than a silent gap. A payment timeout resolves to
 * `cancelled` with `cancellation_reason = 'payment_timeout'`, per task 8's own
 * state machine and demo output — the reason column, not a second status, is
 * what distinguishes it.
 */
const TRANSITIONS: Readonly<
  Record<BookingStatus, Readonly<Partial<Record<BookingEvent, BookingStatus>>>>
> = {
  pending_payment: {
    pay: Status.CONFIRMED,
    payment_timeout: Status.CANCELLED,
  },
  confirmed: {
    check_in: Status.ACTIVE,
    cancel: Status.CANCELLED,
  },
  active: {
    complete: Status.COMPLETED,
    cancel: Status.CANCELLED,
  },
  completed: {},
  cancelled: {},
  expired: {},
  no_show: {},
};

export class IllegalBookingTransitionError extends HttpException {
  constructor(
    readonly from: BookingStatus,
    readonly event: BookingEvent | 'extend',
  ) {
    super(
      {
        error: 'ILLEGAL_BOOKING_TRANSITION',
        message: "This booking can't be changed any more.",
      },
      HttpStatus.CONFLICT,
    );
  }
}

export function nextStatus(from: BookingStatus, event: BookingEvent): BookingStatus | null {
  return TRANSITIONS[from][event] ?? null;
}

export function assertTransition(from: BookingStatus, event: BookingEvent): BookingStatus {
  const to = nextStatus(from, event);
  if (to === null) throw new IllegalBookingTransitionError(from, event);
  return to;
}

export const isTerminal = (status: BookingStatus): boolean =>
  Object.keys(TRANSITIONS[status]).length === 0;

/**
 * Occupancy, not commerce: a `pending_payment` booking holds its slot for the
 * whole payment window, which is the point of the hold.
 */
export const holdsASlot = (status: BookingStatus): boolean =>
  status === Status.PENDING_PAYMENT || status === Status.CONFIRMED || status === Status.ACTIVE;
