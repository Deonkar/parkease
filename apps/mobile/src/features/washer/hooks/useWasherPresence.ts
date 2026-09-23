import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { newIntent } from '@/lib/api';
import { warn } from '@/lib/log';

import { apiErrorCodeOf } from '../api/errors';
import { setAvailability } from '../api/washer';
import {
  startPresence,
  type BeatResult,
  type LocateOutcome,
  type PresenceDeps,
  type PresenceHandle,
} from '../presence';

import { useWasherProfile, washerKeys } from './useWasherQueries';

export type PresenceError =
  | 'permission_denied'
  | 'location_failed'
  | 'not_verified'
  | 'not_registered'
  | 'unreachable';

export type PresenceResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PresenceError };

export interface WasherPresence {
  readonly isOnline: boolean;
  /** A toggle is in flight. */
  readonly busy: boolean;
  /** Why the last beat failed, while online; `null` once one lands again. */
  readonly error: PresenceError | null;
  readonly goOnline: () => Promise<PresenceResult>;
  readonly goOffline: () => Promise<PresenceResult>;
}

/**
 * A beat's failure, in the words a screen can act on. The server's own refusal
 * codes are read out of the rejected PATCH, so an unverified partner is told to
 * wait for approval rather than to check a connection that is fine.
 */
function toPresenceError(result: Exclude<BeatResult, { ok: true }>): PresenceError {
  if (result.reason !== 'unreachable') return result.reason;
  switch (apiErrorCodeOf(result.cause)) {
    case 'WASHER_NOT_VERIFIED':
      return 'not_verified';
    case 'WASHER_PROFILE_NOT_FOUND':
      return 'not_registered';
    default:
      return 'unreachable';
  }
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
        const permission = prompt
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) {
          warn('washer.presence: cannot go online without location permission');
          return { ok: false, reason: 'permission_denied' };
        }

        const deps: PresenceDeps = {
          locate,
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
        // Only the permission call can land here; `startPresence` never rejects.
        warn('washer.presence: could not read location permission', cause);
        return { ok: false, reason: 'location_failed' };
      } finally {
        starting.current = false;
        setBusy(false);
      }
    },
    [client],
  );

  const goOnline = useCallback(() => start(true), [start]);

  const goOffline = useCallback(async (): Promise<PresenceResult> => {
    const current = handle.current;
    if (current === null) return { ok: true };
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
  // from the first profile answer, and without prompting: a partner who has
  // since revoked location sees Offline and can flip the switch themselves.
  const serverSaysOnline = profile.data?.isOnline;
  useEffect(() => {
    if (resumeChecked.current || serverSaysOnline === undefined) return;
    resumeChecked.current = true;
    if (serverSaysOnline) void start(false);
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
