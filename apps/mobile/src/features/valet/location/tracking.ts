import { colors } from '@parkease/tokens';

import { warn } from '@/lib/log';

/**
 * The order in which a valet goes online and offline.
 *
 * Split out of the hook and given injected dependencies because the ordering
 * *is* the correctness here, and a rule that can only be checked on a physical
 * Android device is a rule that silently rots. Nothing in this file imports
 * `expo-location`, so it runs under `environment: 'node'`.
 */

/**
 * Tuned against the R-PERF-06 target device (Redmi 9A class), not an iPhone.
 * A stationary valet costs almost nothing; one in traffic reports every second
 * or two. Shared with the tests so the numbers cannot drift apart.
 */
export const LOCATION_DISTANCE_INTERVAL_M = 20;
export const LOCATION_TIME_INTERVAL_MS = 5_000;

export type StartFailure =
  | 'foreground_denied'
  | 'background_denied'
  | 'unsupported_platform'
  /** The sensor started but the server could not be told. */
  | 'availability_failed';
export type StartResult = { ok: true } | { ok: false; reason: StartFailure };

export interface StartOptions {
  /** `Location.Accuracy`, passed through so this file needs no expo import. */
  readonly accuracy?: unknown;
  /**
   * The foreground-service notification colour. Defaults to the Wayfinder
   * primary — task 12 asks for "the brand orange", but there is no such token
   * and CLAUDE.md records that orange was a direction that was not chosen.
   */
  readonly notificationColor?: string;
}

export interface TrackingDeps {
  /** False where background location does not exist at all — the web preview. */
  readonly supported?: boolean;
  requestForeground(): Promise<{ granted: boolean }>;
  requestBackground(): Promise<{ granted: boolean }>;
  isTaskRegistered(): Promise<boolean>;
  startUpdates(options: unknown): Promise<void>;
  stopUpdates(): Promise<void>;
  setAvailability(isOnline: boolean): Promise<void>;
  flushQueue(): Promise<void>;
}

/** Built here rather than at the call site so the tests assert the real thing. */
export function locationUpdateOptions(accuracy: unknown, notificationColor: string): unknown {
  return {
    accuracy,
    distanceInterval: LOCATION_DISTANCE_INTERVAL_M,
    timeInterval: LOCATION_TIME_INTERVAL_MS,
    // Android kills a background location consumer without a foreground
    // service. It is also the honest thing to do: the valet can see at a glance
    // that they are being tracked.
    foregroundService: {
      notificationTitle: 'ParkEase — you are online',
      notificationBody: 'Sharing your location so drivers can track their car.',
      notificationColor,
      killServiceOnDestroy: false,
    },
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
  };
}

/**
 * Acquire the sensor, and only then tell the server this valet is available.
 *
 * Reversing those two produces a valet who receives offers and cannot be
 * tracked — the driver's map is empty and the job is already accepted.
 *
 * The two permission prompts are sequential and ordered: Android will not grant
 * background location unless foreground is already held, and asking for both at
 * once gets one of them denied.
 */
export async function startTracking(
  deps: TrackingDeps,
  { accuracy, notificationColor = colors.primary }: StartOptions = {},
): Promise<StartResult> {
  if (deps.supported === false) return { ok: false, reason: 'unsupported_platform' };

  const foreground = await deps.requestForeground();
  if (!foreground.granted) return { ok: false, reason: 'foreground_denied' };

  const background = await deps.requestBackground();
  if (!background.granted) return { ok: false, reason: 'background_denied' };

  if (!(await deps.isTaskRegistered())) {
    // Built here, never passed in: an options object assembled at the call site
    // is how the tuned interval gets quietly replaced with someone's guess.
    await deps.startUpdates(locationUpdateOptions(accuracy, notificationColor));
  }

  try {
    await deps.setAvailability(true);
  } catch (error) {
    // The sensor is live but the server does not know this valet is available,
    // so no job will ever route to them. Rolling the sensor back is the honest
    // outcome: a throw here would leave the caller's toggle stuck mid-flight,
    // and a silent success would drain the battery for a feed nobody reads.
    warn('valet.startTracking: could not set availability', error);
    try {
      await deps.stopUpdates();
    } catch (stopError) {
      warn('valet.startTracking: rollback of location updates failed', stopError);
    }
    return { ok: false, reason: 'availability_failed' };
  }

  return { ok: true };
}

/**
 * Drain, stop accepting work, then release the sensor — in that order.
 *
 * The flush comes FIRST because a queued fix is delivered as an availability
 * heartbeat, which asserts `isOnline: true`. Draining after going offline would
 * therefore re-register the valet, and the server would keep dispatching to
 * someone whose shift has ended. Sending the backlog while they are still
 * online keeps every fix (they were carrying the car when it was recorded)
 * without contradicting the thing we are about to say.
 *
 * The invariant that matters is unchanged: **work stops before the sensor is
 * released.** A sensor released first would leave a valet holding a live job
 * with no position feed.
 *
 * `setAvailability` runs even when no task was registered, because local state
 * and the OS can disagree: the user may have revoked permission in Settings
 * while the app was backgrounded, and the server still believes they are online.
 */
export async function stopTracking(deps: TrackingDeps): Promise<void> {
  try {
    await deps.flushQueue();
  } catch (error) {
    // A fix that cannot be delivered is already handled inside the queue; this
    // guards the drain itself so a storage fault cannot strand the valet online.
    warn('valet.stopTracking: flushing queued fixes failed', error);
  }

  try {
    await deps.setAvailability(false);
  } catch (error) {
    // Logged, then carried on deliberately. The valet asked to go offline; if
    // the PATCH fails we must still release the sensor, or the background task
    // runs all night draining a battery on a shift they believe has ended.
    warn('valet.stopTracking: could not clear availability', error);
  }

  if (await deps.isTaskRegistered()) {
    await deps.stopUpdates();
  }
}
