import { describe, expect, it } from 'vitest';

import {
  LOCATION_DISTANCE_INTERVAL_M,
  LOCATION_TIME_INTERVAL_MS,
  startTracking,
  stopTracking,
  type TrackingDeps,
} from '../location/tracking';

/**
 * A recording stand-in for the OS and the API.
 *
 * The assertions here are almost all about ORDER, because every bug this guards
 * is an ordering bug: a valet marked online before the sensor is acquired
 * receives jobs nobody can track, and a sensor released before the server stops
 * sending offers does the same thing in the other direction.
 */
function deps(overrides: Partial<TrackingDeps> = {}) {
  const calls: string[] = [];
  const startArgs: Record<string, unknown>[] = [];

  const base: TrackingDeps = {
    requestForeground: () => {
      calls.push('requestForeground');
      return Promise.resolve({ granted: true });
    },
    requestBackground: () => {
      calls.push('requestBackground');
      return Promise.resolve({ granted: true });
    },
    isTaskRegistered: () => {
      calls.push('isTaskRegistered');
      return Promise.resolve(false);
    },
    startUpdates: (options) => {
      calls.push('startUpdates');
      startArgs.push(options as Record<string, unknown>);
      return Promise.resolve();
    },
    stopUpdates: () => {
      calls.push('stopUpdates');
      return Promise.resolve();
    },
    setAvailability: (isOnline) => {
      calls.push(`setAvailability:${String(isOnline)}`);
      return Promise.resolve();
    },
    flushQueue: () => {
      calls.push('flushQueue');
      return Promise.resolve();
    },
    ...overrides,
  };

  return { deps: base, calls, startArgs };
}

describe('going online', () => {
  it('asks for foreground permission before background', async () => {
    const { deps: d, calls } = deps();

    await startTracking(d);

    expect(calls.indexOf('requestForeground')).toBeLessThan(calls.indexOf('requestBackground'));
  });

  it('never asks for background when foreground was denied', async () => {
    const { deps: d, calls } = deps({
      requestForeground: () => Promise.resolve({ granted: false }),
    });

    const result = await startTracking(d);

    expect(result).toEqual({ ok: false, reason: 'foreground_denied' });
    expect(calls).not.toContain('requestBackground');
  });

  it('tells the server nothing when the sensor could not be acquired', async () => {
    const { deps: d, calls } = deps({
      requestBackground: () => Promise.resolve({ granted: false }),
    });

    const result = await startTracking(d);

    expect(result).toEqual({ ok: false, reason: 'background_denied' });
    // A valet who is "online" but untracked is the worst available state: the
    // driver's map is empty and the job is already accepted.
    expect(calls).not.toContain('setAvailability:true');
    expect(calls).not.toContain('startUpdates');
  });

  it('marks the valet online only after tracking has started', async () => {
    const { deps: d, calls } = deps();

    await startTracking(d);

    expect(calls.indexOf('startUpdates')).toBeLessThan(calls.indexOf('setAvailability:true'));
  });

  it('starts updates with the tuned interval and a foreground service', async () => {
    const { deps: d, startArgs } = deps();

    await startTracking(d);

    expect(startArgs).toHaveLength(1);
    expect(startArgs[0]).toMatchObject({
      distanceInterval: LOCATION_DISTANCE_INTERVAL_M,
      timeInterval: LOCATION_TIME_INTERVAL_MS,
    });
    // Android kills a background location consumer without this.
    expect(startArgs[0]?.['foregroundService']).toBeDefined();
  });

  it('does not start a second time when the task is already registered', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(true) });

    const result = await startTracking(d);

    expect(result).toEqual({ ok: true });
    expect(calls).not.toContain('startUpdates');
  });
});

describe('going offline', () => {
  it('stops accepting work before releasing the sensor', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(true) });

    await stopTracking(d);

    expect(calls.indexOf('setAvailability:false')).toBeLessThan(calls.indexOf('stopUpdates'));
  });

  it('flushes fixes captured before the stop rather than discarding them', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(true) });

    await stopTracking(d);

    expect(calls).toContain('flushQueue');
  });

  it('does not stop updates that were never registered', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(false) });

    await stopTracking(d);

    expect(calls).not.toContain('stopUpdates');
    // The server is still told, because local state may disagree with the OS.
    expect(calls).toContain('setAvailability:false');
  });
});

/**
 * Failures on the *network* half of going on and off duty.
 *
 * Found by the R-FAIL-01 review lens. Both of these left the app in a state the
 * valet could neither see nor escape: a toggle stuck mid-flight, or a sensor
 * still running after they believed they had finished their shift.
 */
/**
 * Found by the test-adequacy lens.
 *
 * `postFix` — the real `send` behind the queue — PATCHes availability with
 * `isOnline: true`, because that is how a heartbeat keeps `last_seen_at` fresh.
 * Draining the queue *after* telling the server the valet is offline therefore
 * re-marks them online, and the server can keep dispatching jobs to someone who
 * has finished their shift.
 *
 * So the flush happens while the valet is still online, and only then do we
 * stop accepting work. The invariant that matters is unchanged: work stops
 * before the sensor is released.
 */
describe('going offline drains before it de-registers', () => {
  it('flushes queued fixes before telling the server the valet is offline', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(true) });

    await stopTracking(d);

    expect(calls.indexOf('flushQueue')).toBeLessThan(calls.indexOf('setAvailability:false'));
  });

  it('still stops accepting work before releasing the sensor', async () => {
    const { deps: d, calls } = deps({ isTaskRegistered: () => Promise.resolve(true) });

    await stopTracking(d);

    expect(calls.indexOf('setAvailability:false')).toBeLessThan(calls.indexOf('stopUpdates'));
  });
});

describe('when the server cannot be reached', () => {
  it('reports a typed failure instead of throwing when going online', async () => {
    const { deps: d } = deps({
      setAvailability: () => Promise.reject(new Error('network down')),
    });

    // A throw here leaves the toggle stuck on 'starting' forever, because the
    // hook never reaches the branch that resets it.
    await expect(startTracking(d)).resolves.toEqual({
      ok: false,
      reason: 'availability_failed',
    });
  });

  it('still releases the sensor when going offline fails server-side', async () => {
    const { deps: d, calls } = deps({
      isTaskRegistered: () => Promise.resolve(true),
      setAvailability: () => Promise.reject(new Error('network down')),
    });

    await stopTracking(d);

    // The valet asked to go offline. Leaving the background task running would
    // drain their battery all night while they believe their shift ended.
    expect(calls).toContain('stopUpdates');
    expect(calls).toContain('flushQueue');
  });

  it('does not leave the sensor running when going online is refused', async () => {
    const { deps: d, calls } = deps({
      setAvailability: () => Promise.reject(new Error('network down')),
    });

    await startTracking(d);

    // Acquired but unusable: roll it back rather than draining battery for a
    // feed the server is not listening to.
    expect(calls).toContain('stopUpdates');
  });
});

describe('a platform with no background location', () => {
  it('reports the platform rather than faking a working feed', async () => {
    const { deps: d, calls } = deps({ supported: false } as Partial<TrackingDeps>);

    const result = await startTracking(d);

    expect(result).toEqual({ ok: false, reason: 'unsupported_platform' });
    expect(calls).not.toContain('setAvailability:true');
  });
});
