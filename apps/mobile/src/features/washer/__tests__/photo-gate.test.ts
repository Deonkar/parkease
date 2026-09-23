import { CARWASH_JOB_STATUS_VALUES } from '@parkease/contracts/enums';
import { describe, expect, it } from 'vitest';

import { canWriteSlot, lockReasonFor, primaryActionFor, slotStateFor } from '../photo-gate';

describe('primaryActionFor', () => {
  it('gives en_route no photo gate — nothing has happened to the car yet', () => {
    expect(primaryActionFor(['en_route'])).toEqual({
      event: 'en_route',
      label: 'On My Way',
      requiresSlot: null,
    });
  });

  it('gates start_washing on the before photo', () => {
    expect(primaryActionFor(['start_washing'])).toEqual({
      event: 'start_washing',
      label: 'Start Washing',
      requiresSlot: 'before',
    });
  });

  it('gates complete on the after photo', () => {
    expect(primaryActionFor(['complete'])).toEqual({
      event: 'complete',
      label: 'Mark Complete',
      requiresSlot: 'after',
    });
  });

  it('renders NO action on a terminal job', () => {
    expect(primaryActionFor([])).toBeNull();
  });

  it('ignores events this screen does not drive, rather than guessing', () => {
    // `cancel` is the driver's and `offer` is dispatch's. A washer screen that
    // rendered a button for either would be firing somebody else's event.
    expect(primaryActionFor(['cancel', 'offer'])).toBeNull();
  });

  it('is deterministic when the server offers more than one event', () => {
    // Lifecycle order, always — so the same job never renders two different
    // buttons on two different devices.
    expect(primaryActionFor(['complete', 'en_route'])?.event).toBe('en_route');
  });
});

/**
 * T7-S1 mirrored: the app offers a capture or a Retake only while the server
 * will accept the write. A button the server then refuses is a lie with a
 * spinner on it.
 */
describe('canWriteSlot', () => {
  const open = (slot: 'before' | 'after') =>
    CARWASH_JOB_STATUS_VALUES.filter((status) => canWriteSlot(slot, status));

  it('opens the before slot from accept until washing starts', () => {
    expect(open('before')).toEqual(['accepted', 'en_route']);
  });

  it('opens the after slot only while washing', () => {
    expect(open('after')).toEqual(['washing']);
  });
});

describe('slotStateFor', () => {
  const idle = { uploading: false, error: null };
  const OPEN = { writable: true };

  it('is attached when the SERVER holds a photo, with nothing local', () => {
    // After a restart there is no local capture at all; the server view alone
    // must still say the obligation is met.
    expect(slotStateFor(true, idle, OPEN)).toBe('attached');
  });

  it('is empty when the server holds nothing and nothing is in flight', () => {
    expect(slotStateFor(false, idle, OPEN)).toBe('empty');
  });

  it('shows an upload in flight, even over an attached photo being retaken', () => {
    expect(slotStateFor(false, { uploading: true, error: null }, OPEN)).toBe('uploading');
    expect(slotStateFor(true, { uploading: true, error: null }, OPEN)).toBe('uploading');
  });

  it('shows a failure until it is retried', () => {
    expect(slotStateFor(false, { uploading: false, error: 'offline' }, OPEN)).toBe('failed');
  });

  it('lets a stale local failure give way once the slot has closed on an attached photo', () => {
    // Before photo attached, washing started: a failed retake can never land,
    // and the server holds a photo — the slot reads done, not failed.
    const failed = { uploading: false, error: 'offline' };

    expect(slotStateFor(true, failed, { writable: false })).toBe('attached');
    expect(slotStateFor(true, failed, { writable: true })).toBe('failed');
    expect(slotStateFor(false, failed, { writable: false })).toBe('failed');
  });
});

describe('lockReasonFor', () => {
  const start = primaryActionFor(['start_washing']);
  const complete = primaryActionFor(['complete']);
  const enRoute = primaryActionFor(['en_route']);

  it('locks Start Washing until the server holds the before photo, and says so', () => {
    expect(lockReasonFor(start, { before: false, after: false })).toBe(
      'Take the before photo to unlock',
    );
    expect(lockReasonFor(start, { before: true, after: false })).toBeNull();
  });

  it('locks Mark Complete until the server holds the after photo, and says so', () => {
    expect(lockReasonFor(complete, { before: true, after: false })).toBe(
      'Take the after photo to unlock',
    );
    expect(lockReasonFor(complete, { before: true, after: true })).toBeNull();
  });

  it('never locks an action that needs no photo', () => {
    expect(lockReasonFor(enRoute, { before: false, after: false })).toBeNull();
  });

  it('has nothing to lock when there is no action', () => {
    expect(lockReasonFor(null, { before: false, after: false })).toBeNull();
  });
});
