import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { newIntent } from '@/lib/api';
import { warn } from '@/lib/log';

import { DEV_WASHER_FIX } from '../api/dev-fixtures';
import { setAvailability } from '../api/washer';
import { isWasherDevMock } from '../dev-mock';
import {
  presenceErrorFor as toPresenceError,
  startPresence,
  type LocateOutcome,
  type PresenceDeps,
  type PresenceError,
  type PresenceHandle,
} from '../presence';

import { useWasherProfile, washerKeys } from './useWasherQueries';

export type { PresenceError } from '../presence';

export type PresenceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PresenceError };

export interface WasherPresence {
  readonly isOnline: boolean;
  /** A toggle is in flight. */
  readonly busy: boolean;
  /**
   * While online: why the last beat failed, `null` once one lands again.
   * While offline: why an automatic resume after an app restart did not work.
   */
  readonly error: PresenceError | null;
  readonly goOnline: () => Promise<PresenceResult>;
  readonly goOffline: () => Promise<PresenceResult>;
}

/** Never prompts: asking is `goOnline`'s job, once, not every 45 seconds. */
async function locate(): Promise<LocateOutcome> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, reason: 'permission_denied' };
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { ok: true, fix: { lat: position.coords.latitude, lng: position.coords.longitude } };
}

/**
 * The dev-mock preview's location: the browser pane refuses `expo-location`
 * outright (learnings.md), so a fixture coordinate stands in (ruling T11-W1).
 */
const locateAtDevFixture = (): Promise<LocateOutcome> =>
  Promise.resolve({ ok: true, fix: DEV_WASHER_FIX });

/**
 * The real dependencies for `startPresence`, and the state the washer tabs read.
 *
 * Mounted ONCE, by `WasherPresenceProvider` in `app/(washer)/_layout.tsx`, so the
 * heartbeat keeps running whichever tab the partner is on.
 *
 * A fresh intent per PATCH is correct here and is not an R-FE-05 violation:
 * each beat is a new fact about where the partner is, and a failed beat is
 * superseded by the next one rather than retried.
 */
export function useWasherPresence(): WasherPresence {
  const client = useQueryClient();
  const profile = useWasherProfile();

  const handle = useRef<PresenceHandle | null>(null);
  const starting = useRef(false);
  /** The start in flight, so a `goOffline` pressed during it can wait it out (I6). */
  const pendingStart = useRef<Promise<PresenceResult> | null>(null);
  const mounted = useRef(true);
  const resumeChecked = useRef(false);

  const [isOnline, setIsOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PresenceError | null>(null);

  const start = useCallback(
    async (prompt: boolean): Promise<PresenceResult> => {
      if (handle.current !== null || starting.current) return { ok: true };
      starting.current = true;
      setBusy(true);
      setError(null);

      try {
        // Under a dev-mock session (`__DEV__` only) nothing is asked of the
        // browser: the fixture stands in for the fix, and the PATCH is the
        // fixture store's (`api/washer.ts`).
        const devMock = await isWasherDevMock();
        if (!devMock) {
          const permission = prompt
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync();
          if (permission.status !== Location.PermissionStatus.GRANTED) {
            warn('washer.presence: cannot go online without location permission');
            return { ok: false, reason: 'permission_denied' };
          }
        }

        const deps: PresenceDeps = {
          locate: devMock ? locateAtDevFixture : locate,
          send: (online, fix) => setAvailability(online, newIntent(), fix),
          onBeat: (result) => {
            setError(result.ok ? null : toPresenceError(result));
          },
        };
        const started = await startPresence(deps);
        if (!started.ok) return { ok: false, reason: toPresenceError(started) };

        // Unmounted while the first PATCH was in flight: nobody is left to stop it.
        if (!mounted.current) {
          started.handle.halt();
          return { ok: true };
        }
        handle.current = started.handle;
        setIsOnline(true);
        void client.invalidateQueries({ queryKey: washerKeys.profile });
        return { ok: true };
      } catch (cause) {
        // Only the permission call (or, in dev, the session read) can land
        // here; `startPresence` never rejects.
        warn('washer.presence: could not read location permission', cause);
        return { ok: false, reason: 'location_failed' };
      } finally {
        starting.current = false;
        setBusy(false);
      }
    },
    [client],
  );

  const goOnline = useCallback(() => {
    const started = start(true);
    pendingStart.current = started;
    const clear = () => {
      if (pendingStart.current === started) pendingStart.current = null;
    };
    started.then(clear, clear);
    return started;
  }, [start]);

  const goOffline = useCallback(async (): Promise<PresenceResult> => {
    // I6: offline pressed while going online is still on its way. Returning
    // now would let the start finish and leave the partner online; instead the
    // stop waits for it, so offline is always where this ends.
    const inFlight = pendingStart.current;
    if (inFlight !== null) {
      setBusy(true);
      await inFlight;
    }
    const current = handle.current;
    if (current === null) {
      // The start failed or was halted: already offline, and nothing is busy.
      if (inFlight !== null) setBusy(false);
      return { ok: true };
    }
    handle.current = null;
    setBusy(true);

    const stopped = await current.stop();
    setIsOnline(false);
    setError(null);
    setBusy(false);
    void client.invalidateQueries({ queryKey: washerKeys.profile });
    return stopped.ok ? { ok: true } : { ok: false, reason: toPresenceError(stopped) };
  }, [client]);

  // An app restart while the server says online resumes the heartbeat — once,
  // from the first profile answer, and without prompting. A resume that fails
  // is surfaced as state, never discarded: the partner believed they were
  // online, so the rail says why they are not (T6-P1, R-FAIL-01). `start`
  // never rejects and has already logged the failure at warn.
  const serverSaysOnline = profile.data?.isOnline;
  useEffect(() => {
    if (resumeChecked.current || serverSaysOnline === undefined) return;
    resumeChecked.current = true;
    if (!serverSaysOnline) return;
    void start(false).then((resumed) => {
      if (!resumed.ok) setError(resumed.reason);
    });
  }, [serverSaysOnline, start]);

  // Leaving the washer tabs (sign-out, role switch) stops the beat but sends
  // nothing: the session may already be gone, and the server drops a silent
  // washer from dispatch once the heartbeat window lapses.
  useEffect(() => {
    mounted.current = true;
    const owned = handle;
    return () => {
      mounted.current = false;
      owned.current?.halt();
      owned.current = null;
    };
  }, []);

  return useMemo(
    () => ({ isOnline, busy, error, goOnline, goOffline }),
    [isOnline, busy, error, goOnline, goOffline],
  );
}
