import { describe, expect, it } from 'vitest';

import {
  CARWASH_JOB_EVENT_VALUES,
  CARWASH_JOB_STATUS_VALUES,
  type CarwashJobEvent,
  type CarwashJobStatus,
} from '../src/enums/index.js';
import {
  CARWASH_TRANSITIONS,
  IllegalCarwashTransitionError,
  isTerminalCarwashStatus,
  nextCarwashStatus,
  parseCarwashJobStatus,
} from '../src/washer/lifecycle.js';

/**
 * The whole machine, written out once.
 *
 * Every other assertion in this file is derived from this table rather than
 * hand-listed, so a status or an event added later is tested the moment it
 * exists — a hand-written list of legal pairs grows a hole silently, and the
 * hole is always the transition nobody thought about.
 */
const LEGAL: readonly (readonly [CarwashJobStatus, CarwashJobEvent, CarwashJobStatus])[] = [
  ['requested', 'offer', 'offered'],
  ['requested', 'cancel', 'cancelled'],
  ['offered', 'accept', 'accepted'],
  ['offered', 'offer', 'offered'],
  ['offered', 'cancel', 'cancelled'],
  ['accepted', 'en_route', 'en_route'],
  ['accepted', 'cancel', 'cancelled'],
  ['en_route', 'start_washing', 'washing'],
  ['en_route', 'cancel', 'cancelled'],
  ['washing', 'complete', 'completed'],
];

describe('the car wash state machine', () => {
  it('covers 7 statuses and 6 events, which is 42 pairs', () => {
    expect(CARWASH_JOB_STATUS_VALUES).toHaveLength(7);
    expect(CARWASH_JOB_EVENT_VALUES).toHaveLength(6);
    expect(CARWASH_JOB_STATUS_VALUES.length * CARWASH_JOB_EVENT_VALUES.length).toBe(42);
  });

  it('allows exactly the legal transitions and refuses the other 32', () => {
    for (const from of CARWASH_JOB_STATUS_VALUES) {
      for (const event of CARWASH_JOB_EVENT_VALUES) {
        const expected = LEGAL.find(([f, e]) => f === from && e === event)?.[2] ?? null;
        expect(nextCarwashStatus(from, event), `${from} + ${event}`).toBe(expected);
      }
    }
  });

  /**
   * The radius expansion, modelled as a self-transition so widening stays inside
   * the machine instead of being a status write that bypasses it.
   */
  it('re-offers from offered without changing the status', () => {
    expect(nextCarwashStatus('offered', 'offer')).toBe('offered');
  });

  /**
   * §13.9. The washer has travelled and started work; cancelling here would mean
   * they eat the trip and the supplies. This is a product decision, so it gets
   * its own line rather than living inside the sweep above.
   */
  it('refuses cancel once the washer has begun washing', () => {
    expect(nextCarwashStatus('washing', 'cancel')).toBeNull();
  });

  it('allows cancel from every state before washing', () => {
    for (const from of ['requested', 'offered', 'accepted', 'en_route'] as const) {
      expect(nextCarwashStatus(from, 'cancel'), from).toBe('cancelled');
    }
  });

  it('lets nothing out of a terminal state', () => {
    for (const from of ['completed', 'cancelled'] as const) {
      for (const event of CARWASH_JOB_EVENT_VALUES) {
        expect(nextCarwashStatus(from, event), `${from} + ${event}`).toBeNull();
      }
    }
  });

  it('treats exactly completed and cancelled as terminal', () => {
    expect(CARWASH_JOB_STATUS_VALUES.filter(isTerminalCarwashStatus)).toEqual([
      'completed',
      'cancelled',
    ]);
  });

  it('has an entry for every status, so a lookup can never be undefined', () => {
    for (const status of CARWASH_JOB_STATUS_VALUES) {
      expect(CARWASH_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('parseCarwashJobStatus', () => {
  it('narrows a status the build knows', () => {
    expect(parseCarwashJobStatus('washing')).toBe('washing');
  });

  /**
   * `wash_jobs.status` is `text` with a CHECK, so a driver read hands back a
   * plain string. A cast would make every transition lookup silently miss when a
   * migration adds a status this build has never heard of; this throws with the
   * offending value instead (R-VAL-01).
   */
  it('throws on a status this build does not know', () => {
    expect(() => parseCarwashJobStatus('polishing')).toThrow(TypeError);
  });
});

describe('IllegalCarwashTransitionError', () => {
  it('carries the state and the event that could not be applied', () => {
    const error = new IllegalCarwashTransitionError('washing', 'cancel');
    expect(error.from).toBe('washing');
    expect(error.event).toBe('cancel');
    expect(error.name).toBe('IllegalCarwashTransitionError');
  });

  /**
   * A plain Error, never an HttpException. Four consumers import this package,
   * one of them a React Native app, and none of them should be dragging Nest in.
   */
  it('is a plain Error, so no transport leaks into contracts', () => {
    expect(new IllegalCarwashTransitionError('washing', 'cancel')).toBeInstanceOf(Error);
  });
});
