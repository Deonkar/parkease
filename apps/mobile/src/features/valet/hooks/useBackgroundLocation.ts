import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { warn } from '@/lib/log';

import {
  ACCURACY_ACTIVE,
  hasBackgroundGrant,
  isTrackingRegistered,
  trackingDeps,
} from '../location/platform';
import { readLastFixAt } from '../location/store';
import { startTracking, stopTracking, type StartResult } from '../location/tracking';

export type TrackingState = 'stopped' | 'starting' | 'tracking';

export interface BackgroundLocation {
  readonly state: TrackingState;
  readonly granted: boolean;
  /** When the newest fix was RECORDED, for the health banner. */
  readonly lastFixAt: number | null;
  start(): Promise<StartResult>;
  stop(): Promise<void>;
}

/** How often the UI re-reads the last-fix timestamp written by the OS task. */
const FIX_POLL_MS = 5_000;

/**
 * The online switch, reconciled against the OS rather than trusted.
 *
 * The switch and the OS can disagree: the valet may revoke permission in
 * Settings while the app is backgrounded, and local state would keep claiming
 * to track. Every foreground re-reads what is actually registered and granted.
 *
 * The ordering rules live in `location/tracking.ts` and are unit-tested there —
 * this hook is the React shell around them, nothing more.
 */
export function useBackgroundLocation(): BackgroundLocation {
  const [state, setState] = useState<TrackingState>('stopped');
  const [granted, setGranted] = useState(false);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);

  /**
   * Suppresses a reconcile while a start/stop is in flight.
   *
   * `startTracking` opens the OS permission dialogs, which themselves push the
   * app through `background → active`. That fires a reconcile whose permission
   * snapshot was taken BEFORE the grant landed; if it resolves after `start()`
   * has set `'tracking'`, it clobbers the toggle back to `'stopped'` while GPS
   * is genuinely running and the server believes the valet is available —
   * precisely the desync this hook exists to prevent.
   */
  const inFlight = useRef(false);
  /**
   * Read through a function on purpose: TypeScript narrows `inFlight.current`
   * to `false` after the first check and then treats the re-check below as dead
   * code — but the value can change across the `await`, which is the entire
   * reason the guard exists.
   */
  const isInFlight = useCallback(() => inFlight.current, []);

  const reconcile = useCallback(async () => {
    if (isInFlight()) return;
    try {
      const [registered, hasGrant] = await Promise.all([
        isTrackingRegistered(),
        hasBackgroundGrant(),
      ]);
      if (isInFlight()) return;
      setGranted(hasGrant);
      setState(registered && hasGrant ? 'tracking' : 'stopped');
    } catch (error) {
      // A native call that throws must not leave an unhandled rejection and a
      // toggle frozen mid-flight (R-FAIL-01).
      warn('valet.useBackgroundLocation: could not reconcile with the OS', error);
    }
  }, [isInFlight]);

  const start = useCallback(async (): Promise<StartResult> => {
    inFlight.current = true;
    setState('starting');
    try {
      const result = await startTracking(trackingDeps, { accuracy: ACCURACY_ACTIVE });
      if (result.ok) {
        setGranted(true);
        setState('tracking');
      } else {
        // Any failure means tracking is not running, so the background grant is
        // not something we can claim to hold — including `foreground_denied`,
        // which is the case where we hold the least.
        setGranted(false);
        setState('stopped');
      }
      return result;
    } catch (error) {
      warn('valet.useBackgroundLocation: start threw', error);
      setGranted(false);
      setState('stopped');
      return { ok: false, reason: 'availability_failed' };
    } finally {
      inFlight.current = false;
    }
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    inFlight.current = true;
    try {
      await stopTracking(trackingDeps);
    } catch (error) {
      warn('valet.useBackgroundLocation: stop threw', error);
    } finally {
      // The switch returns to off either way: the valet asked to go offline,
      // and leaving it reading "online" after a failure is the worse lie.
      setState('stopped');
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void reconcile();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconcile();
    });
    return () => {
      subscription.remove();
    };
  }, [reconcile]);

  // The OS task writes the fix timestamp from a headless context, so the UI has
  // to read it back rather than receive it. Polling is the honest mechanism:
  // there is no event to subscribe to across that boundary.
  useEffect(() => {
    let active = true;

    const read = async () => {
      try {
        const at = await readLastFixAt();
        if (active) setLastFixAt(at);
      } catch (error) {
        warn('valet.useBackgroundLocation: could not read the last fix', error);
      }
    };

    void read();
    const timer = setInterval(() => void read(), FIX_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { state, granted, lastFixAt, start, stop };
}
