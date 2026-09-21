import { describe, expect, it } from 'vitest';

import { VALET_JOB_STATUS_VALUES, ValetJobStatus } from '../src/enums/index.js';
import {
  isTerminalValetStatus,
  nextValetStatus,
  TRACKED_VALET_STATUSES,
  VALET_JOB_EVENT_VALUES,
  ValetJobEvent,
  valetHoldsVehicle,
} from '../src/valet/lifecycle.js';

/**
 * Declared here by hand, on purpose. Generating the expectations from
 * `VALET_TRANSITIONS` would assert that the table equals itself — every edge
 * would pass no matter what the table said. This list is the spec's §11.2
 * diagram transcribed independently; if the two disagree, one of them is wrong
 * and the test says which pair.
 */
const LEGAL: readonly (readonly [string, string, string])[] = [
  ['requested', 'offer', 'offered'],
  ['requested', 'cancel', 'cancelled'],
  ['offered', 'accept', 'accepted'],
  ['offered', 'offer', 'offered'],
  ['offered', 'cancel', 'cancelled'],
  ['accepted', 'depart', 'en_route'],
  ['accepted', 'cancel', 'cancelled'],
  ['en_route', 'arrive', 'arrived'],
  ['en_route', 'cancel', 'cancelled'],
  ['arrived', 'start_parking', 'parking'],
  ['arrived', 'no_show', 'no_show'],
  ['arrived', 'cancel', 'cancelled'],
  ['parking', 'confirm_parked', 'parked'],
  ['parked', 'request_return', 'return_requested'],
  ['parked', 'complete', 'completed'],
  ['return_requested', 'depart_return', 'returning'],
  ['returning', 'complete', 'completed'],
];

const legalKey = new Map(LEGAL.map(([from, event, to]) => [`${from}:${event}`, to]));

describe('the valet lifecycle covers every (status, event) pair', () => {
  it('has 12 statuses and 11 events, so 132 pairs', () => {
    expect(VALET_JOB_STATUS_VALUES).toHaveLength(12);
    expect(VALET_JOB_EVENT_VALUES).toHaveLength(11);
    expect(VALET_JOB_STATUS_VALUES.length * VALET_JOB_EVENT_VALUES.length).toBe(132);
  });

  for (const from of VALET_JOB_STATUS_VALUES) {
    for (const event of VALET_JOB_EVENT_VALUES) {
      const expected = legalKey.get(`${from}:${event}`) ?? null;

      it(`${from} --${event}--> ${expected ?? 'rejected'}`, () => {
        expect(nextValetStatus(from, event)).toBe(expected);
      });
    }
  }
});

describe('the three edges that are not obvious', () => {
  /** Radius expansion is a self-transition so it stays inside the machine. */
  it('offered --offer--> offered, for the widened radius', () => {
    expect(nextValetStatus(ValetJobStatus.OFFERED, ValetJobEvent.OFFER)).toBe(
      ValetJobStatus.OFFERED,
    );
  });

  /** Without this edge a job with no return leg never reaches a terminal state. */
  it('parked --complete--> completed, for a driver who collects their own car', () => {
    expect(nextValetStatus(ValetJobStatus.PARKED, ValetJobEvent.COMPLETE)).toBe(
      ValetJobStatus.COMPLETED,
    );
  });

  /** From `parking` on, a stranger has the keys. That is a support path, not a POST. */
  it('parking --cancel--> rejected', () => {
    expect(nextValetStatus(ValetJobStatus.PARKING, ValetJobEvent.CANCEL)).toBeNull();
    expect(nextValetStatus(ValetJobStatus.RETURN_REQUESTED, ValetJobEvent.CANCEL)).toBeNull();
    expect(nextValetStatus(ValetJobStatus.RETURNING, ValetJobEvent.CANCEL)).toBeNull();
  });
});

describe('isTerminalValetStatus', () => {
  it('is true for exactly completed, cancelled and no_show', () => {
    const terminal = VALET_JOB_STATUS_VALUES.filter(isTerminalValetStatus);
    expect([...terminal].sort()).toEqual(['cancelled', 'completed', 'no_show']);
  });

  it('agrees with the table: a terminal status accepts no event', () => {
    for (const status of VALET_JOB_STATUS_VALUES.filter(isTerminalValetStatus)) {
      for (const event of VALET_JOB_EVENT_VALUES) {
        expect(nextValetStatus(status, event)).toBeNull();
      }
    }
  });
});

describe('valetHoldsVehicle', () => {
  it('is true for exactly parking, return_requested and returning', () => {
    const holding = VALET_JOB_STATUS_VALUES.filter(valetHoldsVehicle);
    expect([...holding].sort()).toEqual(['parking', 'return_requested', 'returning']);
  });

  /**
   * The rule this property exists to guarantee: if a stranger has the car, no
   * `cancel` edge may exist. Stated as a property rather than as three literal
   * assertions, so adding a fourth holding state cannot quietly gain a cancel.
   */
  it('implies cancel is unreachable', () => {
    for (const status of VALET_JOB_STATUS_VALUES.filter(valetHoldsVehicle)) {
      expect(nextValetStatus(status, ValetJobEvent.CANCEL)).toBeNull();
    }
  });
});

describe('TRACKED_VALET_STATUSES', () => {
  it('streams location only while the car is moving, never once parked', () => {
    expect([...TRACKED_VALET_STATUSES].sort()).toEqual([
      'accepted',
      'arrived',
      'en_route',
      'returning',
    ]);
    expect(TRACKED_VALET_STATUSES).not.toContain(ValetJobStatus.PARKED);
    expect(TRACKED_VALET_STATUSES).not.toContain(ValetJobStatus.RETURN_REQUESTED);
  });

  it('never tracks a terminal job', () => {
    for (const status of TRACKED_VALET_STATUSES) {
      expect(isTerminalValetStatus(status)).toBe(false);
    }
  });
});

/**
 * A `Record<ValetJobStatus, …>` makes a missing row a compile error, but an enum
 * member added to the *values* array without a row would still typecheck under a
 * looser edit and then throw `Cannot read properties of undefined` on first use
 * in production. This asserts the key set at runtime too.
 */
describe('no status is missing from the table', () => {
  it('every enum member resolves rather than throwing', () => {
    for (const status of VALET_JOB_STATUS_VALUES) {
      expect(() => nextValetStatus(status, ValetJobEvent.CANCEL)).not.toThrow();
      expect(() => isTerminalValetStatus(status)).not.toThrow();
    }
  });
});
