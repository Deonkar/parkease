import { beforeEach, describe, expect, it, vi } from 'vitest';

const defineTask = vi.fn();

vi.mock('expo-task-manager', () => ({
  defineTask: (name: string, handler: unknown) => {
    defineTask(name, handler);
  },
  isTaskRegisteredAsync: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('expo-location', () => ({
  startLocationUpdatesAsync: vi.fn(),
  stopLocationUpdatesAsync: vi.fn(),
  Accuracy: { High: 6, Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 3 },
}));

const enqueue = vi.fn((fix: unknown) => Promise.resolve(fix));
const recordFailure = vi.fn((message: string) => Promise.resolve(message));

vi.mock('../location/store', () => ({
  valetLocationQueue: {
    enqueue: (fix: unknown) => enqueue(fix),
    drain: vi.fn(() => Promise.resolve()),
    pending: vi.fn(() => Promise.resolve([])),
  },
  recordFixFailure: (message: string) => recordFailure(message),
}));

/**
 * The v1 regression guard, and the reason this whole file exists.
 *
 * ParkEase v1 called `startLocationUpdatesAsync` from a `useEffect` with no task
 * ever registered through `TaskManager.defineTask`, so location stopped the
 * moment the screen unmounted or the app backgrounded — which is most of a
 * valet's shift.
 *
 * `TaskManager` looks the task up BY STRING when the OS wakes the process, and
 * at that moment no component has mounted. So the definition has to happen as a
 * side effect of importing the module. This test imports it with nothing
 * rendered and asserts the definition already happened.
 */
describe('the background location task', () => {
  // Only the handler spies reset. `defineTask` deliberately keeps its history:
  // the module is imported once and its single registration IS the assertion.
  beforeEach(() => {
    enqueue.mockClear();
    recordFailure.mockClear();
  });

  it('is defined by importing the module, with no component rendered', async () => {
    const { VALET_LOCATION_TASK } = await import('../location/task');

    expect(defineTask).toHaveBeenCalledTimes(1);
    expect(defineTask).toHaveBeenCalledWith(VALET_LOCATION_TASK, expect.any(Function));
  });

  it('names the task with a stable string the OS can look up', async () => {
    const { VALET_LOCATION_TASK } = await import('../location/task');

    expect(VALET_LOCATION_TASK).toBe('parkease.valet.location');
  });

  it('enqueues the newest fix rather than sending it from the headless context', async () => {
    await import('../location/task');
    const handler = defineTask.mock.calls[0]?.[1] as (body: unknown) => Promise<void>;

    await handler({
      data: {
        locations: [
          { coords: { latitude: 1, longitude: 2, heading: 10, accuracy: 5 }, timestamp: 1_000 },
          {
            coords: { latitude: 12.9361, longitude: 77.6229, heading: 214, accuracy: 8 },
            timestamp: 2_000,
          },
        ],
      },
      error: null,
    });

    expect(enqueue).toHaveBeenCalledWith({
      lat: 12.9361,
      lng: 77.6229,
      headingDeg: 214,
      accuracyM: 8,
      recordedAt: 2_000,
    });
  });

  it('records an OS-reported failure instead of swallowing it', async () => {
    await import('../location/task');
    const handler = defineTask.mock.calls[0]?.[1] as (body: unknown) => Promise<void>;

    await handler({ data: null, error: { message: 'location services disabled' } });

    // R-FAIL-01: a pin that quietly stopped moving is the failure mode this
    // whole feature exists to make visible.
    expect(recordFailure).toHaveBeenCalledWith('location services disabled');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
