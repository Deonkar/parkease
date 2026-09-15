import { BOOKING_STATUS_VALUES, BookingStatus } from '@parkease/contracts/enums';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_EVENT_VALUES,
  BookingEvent,
  IllegalBookingTransitionError,
  assertTransition,
  holdsASlot,
  isTerminal,
  nextStatus,
} from '../src/domains/booking/lifecycle.js';

/**
 * R-TEST-04 wants this exhaustive, so the table below is the whole cross product
 * of 7 statuses and 5 events. Every pair the table does not name as legal must be
 * rejected — that assertion is what stops a new status quietly becoming reachable.
 */
const LEGAL: ReadonlyArray<readonly [BookingStatus, BookingEvent, BookingStatus]> = [
  [BookingStatus.PENDING_PAYMENT, BookingEvent.PAY, BookingStatus.CONFIRMED],
  [BookingStatus.PENDING_PAYMENT, BookingEvent.PAYMENT_TIMEOUT, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED, BookingEvent.CHECK_IN, BookingStatus.ACTIVE],
  [BookingStatus.CONFIRMED, BookingEvent.CANCEL, BookingStatus.CANCELLED],
  [BookingStatus.ACTIVE, BookingEvent.COMPLETE, BookingStatus.COMPLETED],
  [BookingStatus.ACTIVE, BookingEvent.CANCEL, BookingStatus.CANCELLED],
];

const legalKey = (from: BookingStatus, event: BookingEvent): string => `${from}:${event}`;
const LEGAL_KEYS = new Set(LEGAL.map(([from, event]) => legalKey(from, event)));

describe('booking lifecycle', () => {
  describe('the legal transitions', () => {
    it.each(LEGAL)('%s --%s--> %s', (from, event, expected) => {
      expect(nextStatus(from, event)).toBe(expected);
      expect(assertTransition(from, event)).toBe(expected);
    });
  });

  describe('every other pair is unreachable', () => {
    const illegal = BOOKING_STATUS_VALUES.flatMap((from) =>
      BOOKING_EVENT_VALUES.filter((event) => !LEGAL_KEYS.has(legalKey(from, event))).map(
        (event) => [from, event] as const,
      ),
    );

    it('covers the whole cross product', () => {
      expect(illegal.length + LEGAL.length).toBe(
        BOOKING_STATUS_VALUES.length * BOOKING_EVENT_VALUES.length,
      );
    });

    it.each(illegal)('%s --%s--> rejected', (from, event) => {
      expect(nextStatus(from, event)).toBeNull();
      expect(() => assertTransition(from, event)).toThrow(IllegalBookingTransitionError);
    });
  });

  it('is terminal for exactly the four end states', () => {
    const terminal = BOOKING_STATUS_VALUES.filter(isTerminal);
    expect([...terminal].sort()).toEqual(['cancelled', 'completed', 'expired', 'no_show']);
  });

  it('holds a slot for exactly the three live states', () => {
    const holding = BOOKING_STATUS_VALUES.filter(holdsASlot);
    expect([...holding].sort()).toEqual(['active', 'confirmed', 'pending_payment']);
  });

  it('never holds a slot in a terminal state', () => {
    for (const status of BOOKING_STATUS_VALUES) {
      expect(isTerminal(status) && holdsASlot(status)).toBe(false);
    }
  });

  it('reports the rejected pair on the error, for the log line', () => {
    const error = new IllegalBookingTransitionError(BookingStatus.COMPLETED, BookingEvent.CANCEL);
    expect(error.from).toBe('completed');
    expect(error.event).toBe('cancel');
    expect(error.getStatus()).toBe(409);
  });
});
