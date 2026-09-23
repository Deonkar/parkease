import { describe, expect, it } from 'vitest';

import { primaryActionFor } from '../photo-gate';

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
